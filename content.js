// Cliptown Content Script

let debounceTimer;
const DEBOUNCE_MS = 2000; // Save 2 seconds after typing stops

function saveToCliptown(text) {
    if (!text || text.length < 3) return; // Ignore very short text
    chrome.runtime.sendMessage({ action: 'save_draft', text: text });
}

// Track keyup events
document.addEventListener('keyup', (e) => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.isContentEditable) {
        // Skip password fields
        if (e.target.type === 'password') return;

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            saveToCliptown(e.target.value || e.target.innerText);
        }, DEBOUNCE_MS);
    }
});

// Track blur events (when user clicks away from a field)
document.addEventListener('blur', (e) => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.isContentEditable) {
        if (e.target.type === 'password') return;
        saveToCliptown(e.target.value || e.target.innerText);
    }
}, true);
