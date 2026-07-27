const site = document.querySelector('#site');
const status = document.querySelector('#status');
const enable = document.querySelector('#enable');
const disable = document.querySelector('#disable');
const clear = document.querySelector('#clear');

let currentOrigin = null;
let currentPattern = null;

async function activeOrigin() {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!tab?.url || !/^https?:/.test(tab.url)) throw new Error('Open a normal http(s) page first.');
  const origin = new URL(tab.url).origin;
  return {origin, pattern: `${origin}/*`};
}

async function refresh() {
  try {
    const {origin, pattern} = await activeOrigin();
    currentOrigin = origin;
    currentPattern = pattern;
    site.textContent = origin;
    const result = await chrome.runtime.sendMessage({action: 'origin_status', origin});
    status.textContent = result.enabled ? 'Capture enabled for this origin.' : 'Capture disabled for this origin.';
    enable.hidden = Boolean(result.enabled);
    disable.hidden = !result.enabled;
  } catch (error) {
    status.textContent = error.message;
    enable.disabled = true;
    disable.disabled = true;
  }
}

enable.addEventListener('click', async () => {
  const granted = await chrome.permissions.request({origins: [currentPattern]});
  if (!granted) {
    status.textContent = 'Permission was not granted.';
    return;
  }
  const result = await chrome.runtime.sendMessage({action: 'enable_origin', origin: currentOrigin});
  status.textContent = result.status === 'enabled' ? 'Capture enabled. Reload the page to begin.' : result.message;
  await refresh();
});

disable.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({action: 'disable_origin', origin: currentOrigin});
  await refresh();
});

clear.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({action: 'clear_session_drafts'});
  status.textContent = 'Session drafts cleared.';
});

refresh();
