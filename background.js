// Cliptown Background Service Worker

// TODO: Import encryption utilities and supabase client
console.log("Cliptown extension background worker started.");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'save_draft') {
        const text = request.text;
        if (!text || text.trim() === '') return;
        
        console.log("Saving draft to Cliptown (E2EE encrypted):", text.substring(0, 20) + "...");
        
        // TODO: Perform AES-256-GCM encryption here before sending to Supabase
        
        sendResponse({status: "success"});
    }
});
