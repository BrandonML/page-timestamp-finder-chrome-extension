// Set up global mocks
global.chrome = {
    action: {
        setBadgeText: jest.fn(),
        setBadgeBackgroundColor: jest.fn(),
        setTitle: jest.fn(),
        onClicked: {
            addListener: jest.fn()
        }
    },
    runtime: {
        onInstalled: {
            addListener: jest.fn()
        },
        onMessage: {
            addListener: jest.fn()
        }
    },
    scripting: {
        insertCSS: jest.fn(),
        executeScript: jest.fn()
    },
    tabs: {
        create: jest.fn()
    }
};

const fs = require('fs');
const path = require('path');
const bgScriptContent = fs.readFileSync(path.resolve(__dirname, '../background.js'), 'utf-8');

// Run the script in the global context to get access to functions
// We can't just eval it into the global scope simply if it defines functions normally,
// so we'll construct a function that returns the required inner functions.
const getBackgroundFunctions = new Function('chrome', `
    ${bgScriptContent}
    return { updateNoTimestampState, updateTimestampState };
`);

const { updateNoTimestampState, updateTimestampState } = getBackgroundFunctions(global.chrome);

describe('Background Script UI State Logic', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('updateNoTimestampState correctly updates badge and title', () => {
        updateNoTimestampState(123);

        expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: "✗", tabId: 123 });
        expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: "#F44336", tabId: 123 });
        expect(chrome.action.setTitle).toHaveBeenCalledWith({ title: "No timestamp found", tabId: 123 });
    });

    test('updateTimestampState correctly updates badge and title with dates', () => {
        const publishedDate = '2026-03-16T12:00:00Z';
        const modifiedDate = '2026-03-17T12:00:00Z';
        updateTimestampState(456, { published: publishedDate, modified: modifiedDate });

        expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: "✓", tabId: 456 });
        expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: "#4CAF50", tabId: 456 });
        expect(chrome.action.setTitle).toHaveBeenCalledWith({
            title: `Published: ${new Date(publishedDate).toLocaleString()}\nModified: ${new Date(modifiedDate).toLocaleString()}`,
            tabId: 456
        });
    });
});
