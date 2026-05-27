
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const message = (typeof chrome !== 'undefined' && chrome.i18n) ? chrome.i18n.getMessage(element.getAttribute('data-i18n')) : null;
        if (message) {
            element.textContent = message;
        }
    });
});
