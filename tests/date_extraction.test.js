// Set up global mocks before importing
global.chrome = {
    storage: {
        sync: {
            get: jest.fn((defaults, callback) => callback(defaults))
        }
    },
    runtime: {
        sendMessage: jest.fn()
    }
};

// jest-environment-jsdom provides global.window and global.document

// Mock window.location for HTTP headers check in findTimestamps
delete window.location;
window.location = new URL('http://localhost');

global.fetch = jest.fn(() => Promise.resolve({
    headers: { get: () => null }
}));

const fs = require('fs');
const path = require('path');
const contentScriptContent = fs.readFileSync(path.resolve(__dirname, '../content.js'), 'utf-8');

// Run the script in the global context
const contentModule = eval(`(function() {
    var module = {exports: {}};
    ${contentScriptContent};
    return module.exports;
})()`);

// Mock the system date to March 20, 2026, to ensure tests are stable and
// the user's March 16, 2026 example is considered "past".
beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-20T12:00:00Z'));
});

afterAll(() => {
    jest.useRealTimers();
});

describe('Date Extraction Logic (findDate)', () => {
    test('parses ISO strings', async () => {
        const isoString = '2026-03-16T15:00:00Z';
        const formatted = await contentModule.formatDate(isoString);
        // Default format is YYYY-MM-DD
        expect(formatted).toContain('2026-03-16');
    });

    test('parses human readable strings', async () => {
        const readableString = 'March 16, 2026';
        const formatted = await contentModule.formatDate(readableString);
        expect(formatted).toContain('2026-03-16');
    });

    test('parses relative dates', async () => {
        // "2 days ago"
        const formatted = await contentModule.formatDate('2 days ago');

        const expectedDate = new Date();
        expectedDate.setDate(expectedDate.getDate() - 2);
        const year = expectedDate.getFullYear();
        const month = String(expectedDate.getMonth() + 1).padStart(2, '0');
        const day = String(expectedDate.getDate()).padStart(2, '0');

        expect(formatted).toContain(`${year}-${month}-${day}`);
    });

    test('ignores future dates', async () => {
        const futureDate = new Date();
        futureDate.setFullYear(futureDate.getFullYear() + 1);
        const formatted = await contentModule.formatDate(futureDate.toISOString());
        // Since it returns null, it falls back to the original string
        expect(formatted).toBe(futureDate.toISOString());
    });

    test('parses Unix timestamps (seconds)', async () => {
        const unixTimestamp = '1773652032'; // Mon Mar 16 2026 09:07:12 UTC
        const formatted = await contentModule.formatDate(unixTimestamp);
        expect(formatted).toContain('2026-03-16');
    });

    test('parses Unix timestamps (milliseconds)', async () => {
        const unixTimestampMs = '1773652032000';
        const formatted = await contentModule.formatDate(unixTimestampMs);
        expect(formatted).toContain('2026-03-16');
    });
});

describe('Priority Hierarchy Validation', () => {
    beforeEach(() => {
        // Clear DOM
        document.head.innerHTML = '';
        document.body.innerHTML = '';

        // Reset mocks
        global.chrome.runtime.sendMessage.mockClear();
    });

    test('Priority 1: ld+json schema is prioritized over meta tags', async () => {
        document.head.innerHTML = `
            <meta property="article:modified_time" content="2023-01-01T00:00:00Z">
            <script type="application/ld+json">
                {
                    "@context": "https://schema.org",
                    "@type": "Article",
                    "dateModified": "2024-01-01T00:00:00Z"
                }
            </script>
        `;

        await window.findTimestamps();

        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                modified: "2024-01-01T00:00:00Z"
            })
        );
    });

    test('Priority 2: meta tags prioritized over <time> tags', async () => {
        document.head.innerHTML = `
            <meta property="article:modified_time" content="2023-01-01T00:00:00Z">
        `;
        document.body.innerHTML = `
            <time class="updated" datetime="2022-01-01T00:00:00Z">Jan 1, 2022</time>
        `;

        await window.findTimestamps();

        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                modified: "2023-01-01T00:00:00Z"
            })
        );
    });

    test('Priority 3: <time> tags prioritized over regex scan', async () => {
        document.body.innerHTML = `
            <time class="updated" datetime="2022-01-01T00:00:00Z">Jan 1, 2022</time>
            <div>Updated on 2021-01-01</div>
        `;

        await window.findTimestamps();

        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                modified: "2022-01-01T00:00:00Z"
            })
        );
    });

    test('Priority 4: URL scan as fallback before regex scan', async () => {
        // Test using mock document body elements instead of window.location, which jsdom protects.
        // The script checks window.location.pathname, we mock it globally on the module since the content.js
        // is evaluated in its own scope and we can just pass the URL logic test here.
        // Actually, let's execute the logic within our mocked JSDOM environment by just defining it on a
        // new object if window.location can't be mocked. Wait, earlier we deleted window.location at the top level!

        const oldPathname = window.location.pathname;

        // To bypass jsdom's location lock, we can use history.pushState
        window.history.pushState({}, 'Test', '/2023/10/15/my-article/');

        document.body.innerHTML = `
            <div>Updated on 2021-01-01</div>
        `;
        document.body.innerText = "Updated on 2021-01-01";

        await window.findTimestamps();

        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                modified: "2021-01-01",
                published: "2023-10-15T00:00:00.000Z" // From URL
            })
        );

        // reset
        window.history.pushState({}, 'Test', oldPathname);
    });

    test('Overlay has correct z-index', async () => {
        await window.findTimestamps();
        const overlay = document.getElementById('last-modified-overlay');
        expect(overlay.style.zIndex).toBe('2147483647');
    });

    test('processStructuredData correctly handles nested JSON objects', () => {
        const results = { modified: null, published: null, created: null };
        const data = {
            "@context": "https://schema.org",
            "@graph": [
                {
                    "@type": "WebPage",
                    "datePublished": "2023-01-01T00:00:00Z"
                },
                {
                    "@type": "Article",
                    "dateModified": "2023-01-02T00:00:00Z"
                }
            ]
        };

        contentModule.processStructuredData(data, results);
        expect(results.published).toBe("2023-01-01T00:00:00Z");
        expect(results.modified).toBe("2023-01-02T00:00:00Z");
    });

    test('findStructuredData uses dateCreated if datePublished is missing', async () => {
        document.head.innerHTML = `
            <script type="application/ld+json">
                {
                    "@context": "https://schema.org",
                    "@type": "QAPage",
                    "dateCreated": "2026-05-11T18:54:24.404Z",
                    "dateModified": "2026-05-12T18:54:24.404Z"
                }
            </script>
        `;

        await window.findTimestamps();

        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                published: "2026-05-11T18:54:24.404Z",
                modified: "2026-05-12T18:54:24.404Z"
            })
        );
    });

    test('findStructuredData prioritizes datePublished over dateCreated', async () => {
        document.head.innerHTML = `
            <script type="application/ld+json">
                {
                    "@context": "https://schema.org",
                    "@type": "Article",
                    "datePublished": "2025-01-01T00:00:00Z",
                    "dateCreated": "2024-01-01T00:00:00Z",
                    "dateModified": "2025-01-02T00:00:00Z"
                }
            </script>
        `;

        await window.findTimestamps();

        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                published: "2025-01-01T00:00:00Z",
                modified: "2025-01-02T00:00:00Z"
            })
        );
    });

    test('HTTP header fallback catches network errors without crashing', async () => {
        global.fetch.mockImplementationOnce(() => Promise.reject(new Error('Network error')));
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

        document.body.innerHTML = '';
        document.head.innerHTML = '';

        await window.findTimestamps();

        expect(spy).toHaveBeenCalledWith('Error checking HTTP headers:', expect.any(Error));
        spy.mockRestore();
    });

    test('findStructuredData handles JSON with bad control characters', async () => {
        // Mock console.error to avoid noise in test output
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

        document.head.innerHTML = `
            <script type="application/ld+json">
                {
                    "@context": "https://schema.org",
                    "@type": "Article",
                    "headline": "Title with a
newline",
                    "dateModified": "2024-01-01T00:00:00Z"
                }
            </script>
        `;

        await window.findTimestamps();

        // With the fix, it should NOT log an error anymore
        expect(spy).not.toHaveBeenCalled();

        // And it should correctly extract the date
        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                modified: "2024-01-01T00:00:00Z"
            })
        );

        spy.mockRestore();
    });

    test('Priority 4: Regex scan as fallback', async () => {
        document.body.innerHTML = `
            <div>Updated on 2021-01-01</div>
            <div>Published on 2020-01-01</div>
        `;
        // Manually update innerText for JSDOM
        document.body.innerText = "Updated on 2021-01-01\\nPublished on 2020-01-01";

        await window.findTimestamps();

        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                modified: "2021-01-01",
                published: "2020-01-01"
            })
        );
    });
});
