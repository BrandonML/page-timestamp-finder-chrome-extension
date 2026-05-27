// content.js - Content script that runs on demand
console.log("Content script successfully injected and running.");

function findDate(dateString) {
    if (!dateString) return null;

    const now = new Date();
    const futureThreshold = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24-hour buffer

    function validateDate(parsedDate) {
        if (!isNaN(parsedDate)) {
            if (parsedDate > futureThreshold) return null;
            return parsedDate;
        }
        return undefined;
    }

    // Try Unix timestamp (10 digits for seconds, 13 for milliseconds)
    if (/^\d{10}$/.test(dateString)) {
        let parsedDate = new Date(parseInt(dateString) * 1000);
        let validDate = validateDate(parsedDate);
        if (validDate !== undefined) return validDate;
    } else if (/^\d{13}$/.test(dateString)) {
        let parsedDate = new Date(parseInt(dateString));
        let validDate = validateDate(parsedDate);
        if (validDate !== undefined) return validDate;
    }

    // Try ISO and standard JS Date parsing
    let parsedDate = new Date(dateString);
    let validDate = validateDate(parsedDate);
    if (validDate !== undefined) return validDate;

    // Try relative dates like "2 days ago"
    const relativeMatch = dateString.toLowerCase().match(/^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/);
    if (relativeMatch) {
        const value = parseInt(relativeMatch[1]);
        const unit = relativeMatch[2];
        const now = new Date();

        switch (unit) {
            case 'second': now.setSeconds(now.getSeconds() - value); break;
            case 'minute': now.setMinutes(now.getMinutes() - value); break;
            case 'hour': now.setHours(now.getHours() - value); break;
            case 'day': now.setDate(now.getDate() - value); break;
            case 'week': now.setDate(now.getDate() - (value * 7)); break;
            case 'month': now.setMonth(now.getMonth() - value); break;
            case 'year': now.setFullYear(now.getFullYear() - value); break;
        }
        return now;
    }

    return null;
}

async function formatDate(dateString, preFetchedSettings = null) {
    if (!dateString) return null;
    try {
        const date = findDate(dateString);
        if (!date) return dateString;

        const settings = preFetchedSettings || await new Promise(resolve => {
            chrome.storage.sync.get({
                dateFormat: 'YYYY-MM-DD',
                timeFormat: '24-hour'
            }, items => resolve(items));
        });

        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');

        let datePart;
        switch (settings.dateFormat) {
            case 'DD/MM/YYYY':
                datePart = `${day}/${month}/${year}`;
                break;
            case 'MM/DD/YYYY':
                datePart = `${month}/${day}/${year}`;
                break;
            case 'YYYY-MM-DD':
            default:
                datePart = `${year}-${month}-${day}`;
                break;
        }

        let timePart;
        if (settings.timeFormat === '12-hour') {
            let hours = date.getHours();
            const minutes = String(date.getMinutes()).padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12; // hour '0' should be '12'
            timePart = `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
        } else {
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            timePart = `${hours}:${minutes}`;
        }

        return `${datePart} ${timePart}`;
    } catch (e) {
        console.error("Error formatting date:", e);
        return dateString;
    }
}

function findStructuredData() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    let results = { modified: null, published: null, created: null, modifiedType: null, publishedType: null, createdType: null };
    for (const script of scripts) {
        try {
            // Sanitize script content by replacing unescaped control characters (ASCII 0-31) with spaces
            // This prevents JSON.parse from failing on things like literal newlines in strings.
            const sanitizedContent = script.textContent.replace(/[\u0000-\u001F]/g, ' ');
            const data = JSON.parse(sanitizedContent);
            processStructuredData(data, results);
            if (results.modified && (results.published || results.created)) break;
        } catch (e) {
            console.error('Error parsing structured data:', e);
        }
    }
    if (!results.published && results.created) {
        results.published = results.created;
    }
    return results.modified || results.published ? results : null;
}

function processStructuredData(data, results, parentType = null) {
    if (Array.isArray(data)) {
        for (const item of data) {
            processStructuredData(item, results, parentType);
        }
        return;
    }
    if (!data || typeof data !== 'object') return;

    let currentType = parentType;
    if (data['@type']) {
        currentType = Array.isArray(data['@type']) ? data['@type'][0] : data['@type'];
        const typeLower = typeof currentType === 'string' ? currentType.toLowerCase() : '';
        if (['review', 'userreview', 'comment', 'usercomments'].includes(typeLower)) {
            return;
        }
    }

    if (data.dateModified && !results.modified) {
        results.modified = data.dateModified;
        results.modifiedType = currentType;
    }
    if (data.datePublished && !results.published) {
        results.published = data.datePublished;
        results.publishedType = currentType;
    }
    if (data.dateCreated && !results.created) {
        results.created = data.dateCreated;
        results.createdType = currentType;
    }

    for (const key in data) {
        const keyLower = key.toLowerCase();
        if (['review', 'reviews', 'comment', 'comments'].includes(keyLower)) {
            continue;
        }

        if (typeof data[key] === 'object' && data[key] !== null) {
            processStructuredData(data[key], results, currentType);
        }
    }
}

// This function will be executed when the extension icon is clicked
window.findTimestamps = async function () {
    let modifiedTimestamp = null, publishedTimestamp = null;
    let modifiedSource = null, publishedSource = null;

    const settings = await new Promise(resolve => {
        chrome.storage.sync.get({
            dateFormat: 'YYYY-MM-DD',
            timeFormat: '24-hour'
        }, items => resolve(items));
    });

    // Create overlay element
    let overlay = document.getElementById('last-modified-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'last-modified-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background-color: rgba(0, 0, 0, 0.7);
            color: white;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 14px;
            z-index: 2147483647;
            font-family: Arial, sans-serif;
            max-width: 300px;
            transition: opacity 0.3s;
        `;
        document.body.appendChild(overlay);
    }

    // Priority 1: Check for Schema.org structured data (ld+json)
    const structuredData = findStructuredData();
    if (structuredData) {
        if (structuredData.modified) {
            modifiedTimestamp = structuredData.modified;
            modifiedSource = `${chrome.i18n.getMessage("sourceSchema")} (${structuredData.modifiedType || chrome.i18n.getMessage("unknownSchema") || 'Unknown'})`;
        }
        if (structuredData.published) {
            publishedTimestamp = structuredData.published;
            publishedSource = `${chrome.i18n.getMessage("sourceSchema")} (${structuredData.publishedType || chrome.i18n.getMessage("unknownSchema") || 'Unknown'})`;
        }
    }

    // Priority 2: article:modified_time or og:updated_time meta tags
    if (!modifiedTimestamp || !publishedTimestamp) {
        const metaTags = document.querySelectorAll('meta');
        for (const meta of metaTags) {
            const property = meta.getAttribute('property') || meta.getAttribute('name');
            const httpEquiv = meta.getAttribute('http-equiv');

            if (httpEquiv && httpEquiv.toLowerCase() === 'last-modified' && !modifiedTimestamp) {
                modifiedTimestamp = meta.getAttribute('content');
                modifiedSource = chrome.i18n.getMessage("sourceMeta");
            }

            if (property) {
                const lowerProp = property.toLowerCase();
                if (!modifiedTimestamp && (lowerProp === 'article:modified_time' || lowerProp === 'og:updated_time')) {
                    modifiedTimestamp = meta.getAttribute('content');
                    modifiedSource = chrome.i18n.getMessage("sourceMetaProp");
                }
                if (!publishedTimestamp && (lowerProp === 'article:published_time' || lowerProp === 'og:published_time' || lowerProp === 'published_time' || lowerProp === 'publication_date' || lowerProp === 'date' || lowerProp === 'dc.date')) {
                    publishedTimestamp = meta.getAttribute('content');
                    publishedSource = chrome.i18n.getMessage("sourceMetaProp");
                }
            }
            if (modifiedTimestamp && publishedTimestamp) break;
        }
    }

    // Priority 3: <time> HTML tags
    if (!modifiedTimestamp || !publishedTimestamp) {
        const timeElements = document.querySelectorAll('time');
        for (const timeElement of timeElements) {
            const timestamp = timeElement.getAttribute('datetime') || timeElement.textContent.trim();
            // Try to figure out if it's published or modified based on class or text
            const classList = timeElement.className.toLowerCase();
            const textContent = timeElement.parentElement?.textContent.toLowerCase() || "";

            if (!modifiedTimestamp && (classList.includes('mod') || classList.includes('update') || textContent.includes('update') || textContent.includes('modifi'))) {
                modifiedTimestamp = timestamp;
                modifiedSource = chrome.i18n.getMessage("sourceTimeTag");
            } else if (!publishedTimestamp && (classList.includes('pub') || textContent.includes('publish') || textContent.includes('post'))) {
                publishedTimestamp = timestamp;
                publishedSource = chrome.i18n.getMessage("sourceTimeTag");
            } else if (!publishedTimestamp) {
                // Default to published if we don't know
                publishedTimestamp = timestamp;
                publishedSource = chrome.i18n.getMessage("sourceTimeTag");
            }
            if (modifiedTimestamp && publishedTimestamp) break;
        }
    }

    // Priority 4: Regex scan of header/body text (fallback)
    if (!modifiedTimestamp && !publishedTimestamp) {
        // Fallback to older class-based querying first
        const modElement = document.querySelector('[itemprop="dateModified"], .post-date, .article-date, .updated, .date-modified');
        if (modElement && !modifiedTimestamp) {
            modifiedTimestamp = modElement.getAttribute('datetime') || modElement.textContent.trim();
            modifiedSource = chrome.i18n.getMessage("sourceContent");
        }

        const pubElement = document.querySelector('[itemprop="datePublished"], .publish-date, .timestamp, .date-published');
        if (pubElement && !publishedTimestamp) {
            publishedTimestamp = pubElement.getAttribute('datetime') || pubElement.textContent.trim();
            publishedSource = chrome.i18n.getMessage("sourceContent");
        }

        // Check URL for dates before full body scan
        if (!publishedTimestamp && window.location && window.location.pathname) {
            const urlDateRegex = /\/(20\d{2})\/(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])/;
            const match = window.location.pathname.match(urlDateRegex);
            if (match) {
                const urlDate = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
                if (!isNaN(urlDate) && urlDate <= new Date()) {
                    publishedTimestamp = urlDate.toISOString();
                    publishedSource = chrome.i18n.getMessage("sourceUrl");
                }
            }
        }

        // Regex scan for dates
        if (!modifiedTimestamp || !publishedTimestamp) {
            const bodyText = document.body.textContent;
            // Matches something like "Published: Jan 1, 2023" or "Updated on 2023-01-01"
            const dateRegex = /(?:published|posted|updated|modified)(?:\s+on|\s*:)?\s*([a-zA-Z]+\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/gi;

            let match;
            while ((match = dateRegex.exec(bodyText)) !== null) {
                const isUpdate = match[0].toLowerCase().includes('updat') || match[0].toLowerCase().includes('modif');
                if (isUpdate && !modifiedTimestamp) {
                    modifiedTimestamp = match[1];
                    modifiedSource = chrome.i18n.getMessage("sourceRegex");
                } else if (!isUpdate && !publishedTimestamp) {
                    publishedTimestamp = match[1];
                    publishedSource = chrome.i18n.getMessage("sourceRegex");
                }
                if (modifiedTimestamp && publishedTimestamp) break;
            }
        }
    }

    // Step 5: Check HTTP headers for Last-Modified (only if modified is still missing)
    if (!modifiedTimestamp) {
        try {
            const response = await fetch(window.location.href, { method: 'HEAD' });
            const lastModifiedHeader = response.headers.get('last-modified');
            if (lastModifiedHeader) {
                const now = new Date();
                const lastModDate = new Date(lastModifiedHeader);
                if ((now - lastModDate) / (1000 * 60) > 5) { // 5 minute threshold
                    modifiedTimestamp = lastModifiedHeader;
                    modifiedSource = chrome.i18n.getMessage("sourceHttp");
                }
            }
        } catch (error) {
            console.error('Error checking HTTP headers:', error);
        }
    }

    await displayTimestamps(overlay, publishedTimestamp, publishedSource, modifiedTimestamp, modifiedSource, settings);
};

function removeOverlay(overlayElement) {
    setTimeout(() => {
        overlayElement.style.opacity = '0';
        setTimeout(() => {
            if (overlayElement.parentNode) {
                overlayElement.parentNode.removeChild(overlayElement);
            }
        }, 500);
    }, 5000);
}

async function displayTimestamps(overlayElement, publishedTimestamp, publishedSource, modifiedTimestamp, modifiedSource, settings = null) {
    if (publishedTimestamp || modifiedTimestamp) {
        await displayTimestamp(publishedTimestamp, publishedSource, modifiedTimestamp, modifiedSource, overlayElement, settings);
    } else {
        overlayElement.textContent = chrome.i18n.getMessage("noTimestampFound") || "No reliable timestamp found";
        overlayElement.style.backgroundColor = 'rgba(244, 67, 54, 0.9)';
        chrome.runtime.sendMessage({ published: null, modified: null });
        removeOverlay(overlayElement);
    }
}

async function displayTimestamp(pubDate, pubSource, modDate, modSource, overlayElement, settings = null) {
    overlayElement.textContent = ''; // Clear previous content

    const createSection = async (label, date, source) => {
        const container = document.createElement('div');
        const strong = document.createElement('strong');
        strong.textContent = label;
        container.appendChild(strong);
        container.appendChild(document.createElement('br'));

        const formattedDate = await formatDate(date, settings);
        if (formattedDate) {
            container.appendChild(document.createTextNode(formattedDate));
            container.appendChild(document.createElement('br'));
            const small = document.createElement('small');
            small.textContent = `(${source})`;
            container.appendChild(small);
        } else {
            container.appendChild(document.createTextNode(chrome.i18n.getMessage("notFound") || "Not found"));
        }
        return container;
    };

    const pubSection = await createSection(chrome.i18n.getMessage("publishedLabel") || "Published:", pubDate, pubSource);
    overlayElement.appendChild(pubSection);
    overlayElement.appendChild(document.createElement('br'));

    const modSection = await createSection(chrome.i18n.getMessage("modifiedLabel") || "Last Modified:", modDate, modSource);
    overlayElement.appendChild(modSection);

    overlayElement.style.backgroundColor = 'rgba(33, 150, 243, 0.9)';
    chrome.runtime.sendMessage({ published: pubDate, modified: modDate });

    removeOverlay(overlayElement);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        formatDate,
        findStructuredData,
        processStructuredData,
        displayTimestamps,
        displayTimestamp
    };
}
