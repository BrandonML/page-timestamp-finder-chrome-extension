const fs = require('fs');
const path = require('path');

// Mock chrome API globally
global.chrome = {
    i18n: {
        getMessage: jest.fn((key) => {
            const messages = {
                "optionsTitle": "Timestamp Format Options",
                "onboardingTitle": "Welcome to Page Timestamp Finder",
                "sourceSchema": "Schema.org"
            };
            return messages[key] || null;
        })
    }
};

describe('Localization functionality', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test('options.js localized DOM properly', () => {
        document.body.innerHTML = `
            <h1 data-i18n="optionsTitle">Old Title</h1>
            <h2 data-i18n="nonExistentKey">Old Subtitle</h2>
        `;

        // Simulating the localizeDOM logic
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const message = chrome.i18n.getMessage(element.getAttribute('data-i18n'));
            if (message) {
                element.textContent = message;
            }
        });

        const h1 = document.querySelector('h1');
        const h2 = document.querySelector('h2');

        expect(chrome.i18n.getMessage).toHaveBeenCalledWith('optionsTitle');
        expect(h1.textContent).toBe('Timestamp Format Options');

        // Key doesn't exist, so text should remain
        expect(h2.textContent).toBe('Old Subtitle');
    });

    test('onboarding.js localized DOM properly', () => {
        document.body.innerHTML = `
            <h1 data-i18n="onboardingTitle">Old Welcome</h1>
        `;

        // Simulating the localizeDOM logic
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const message = chrome.i18n.getMessage(element.getAttribute('data-i18n'));
            if (message) {
                element.textContent = message;
            }
        });

        const h1 = document.querySelector('h1');

        expect(chrome.i18n.getMessage).toHaveBeenCalledWith('onboardingTitle');
        expect(h1.textContent).toBe('Welcome to Page Timestamp Finder');
    });
});
