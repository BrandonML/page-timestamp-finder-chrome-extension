// background.js - Background service worker

function sanitizeUrl(urlString) {
    if (!urlString) return urlString;
    try {
        const urlObj = new URL(urlString);
        return urlObj.origin + urlObj.pathname;
    } catch (e) {
        return 'invalid-url';
    }
}

// Open onboarding page on install
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        chrome.tabs.create({
            url: 'onboarding.html'
        });
    }
});

/**
 * Updates the extension badge and title to indicate no timestamp was found.
 * @param {number} tabId
 */
function updateNoTimestampState(tabId) {
    chrome.action.setBadgeText({ text: "✗", tabId: tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#F44336", tabId: tabId });
    chrome.action.setTitle({ title: "No timestamp found", tabId: tabId });
}

/**
 * Updates the extension badge and title with the found timestamps.
 * @param {number} tabId
 * @param {object} message
 */
function updateTimestampState(tabId, message) {
    chrome.action.setBadgeText({ text: "✓", tabId: tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#4CAF50", tabId: tabId });

    let title = [];
    if (message.published) {
        title.push(`Published: ${new Date(message.published).toLocaleString()}`);
    }
    if (message.modified) {
        title.push(`Modified: ${new Date(message.modified).toLocaleString()}`);
    }
    chrome.action.setTitle({ title: title.join('\n'), tabId: tabId });
}

chrome.action.onClicked.addListener(async (tab) => {
    const url = tab?.url || '';
    const tabId = tab?.id;

    let protocol = '';

    try {
        protocol = new URL(url).protocol;
    } catch (error) {
        console.warn('Unsupported page for extension action: invalid or missing URL.', {
            tabId,
            url: sanitizeUrl(url),
            error: error.message
        });
        return;
    }

    if (!tabId || (protocol !== 'http:' && protocol !== 'https:')) {
        console.warn('Unsupported page for extension action: only http/https tabs with valid IDs are supported.', {
            tabId,
            url: sanitizeUrl(url),
            protocol
        });
        return;
    }

    try {
        console.log("Injecting content.js into tab:", tabId);
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js']
        });

        // Call the findTimestamps function
        await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                if (window.findTimestamps) {
                    window.findTimestamps();
                } else {
                    console.error("findTimestamps function not found.");
                }
            }
        });
    } catch (error) {
        updateNoTimestampState(tabId);
    }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender) => {
    const tabId = sender.tab.id;
    if (message.published || message.modified) {
        updateTimestampState(tabId, message);
    } else {
        updateNoTimestampState(tabId);
    }
});
