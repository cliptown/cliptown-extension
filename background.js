const ORIGINS_KEY = 'captureOrigins';
const SESSION_DRAFTS_KEY = 'sessionDrafts';
const MAX_SESSION_DRAFTS = 20;

function originPattern(origin) {
  return `${origin}/*`;
}

function scriptId(origin) {
  let hash = 5381;
  for (const character of origin) hash = ((hash << 5) + hash) ^ character.charCodeAt(0);
  return `cliptown_${(hash >>> 0).toString(16)}`;
}

async function getOrigins() {
  const stored = await chrome.storage.local.get(ORIGINS_KEY);
  return Array.isArray(stored[ORIGINS_KEY]) ? stored[ORIGINS_KEY] : [];
}

async function setOrigins(origins) {
  await chrome.storage.local.set({[ORIGINS_KEY]: [...new Set(origins)].sort()});
}

async function registerOrigin(origin) {
  const id = scriptId(origin);
  await chrome.scripting.unregisterContentScripts({ids: [id]}).catch(() => undefined);
  await chrome.scripting.registerContentScripts([{
    id,
    matches: [originPattern(origin)],
    js: ['policy.js', 'content.js'],
    runAt: 'document_idle',
    persistAcrossSessions: true,
  }]);
}

async function enableOrigin(origin) {
  const allowed = await chrome.permissions.contains({origins: [originPattern(origin)]});
  if (!allowed) throw new Error('origin permission was not granted');
  const origins = await getOrigins();
  await setOrigins([...origins, origin]);
  await registerOrigin(origin);
}

async function disableOrigin(origin) {
  await chrome.scripting.unregisterContentScripts({ids: [scriptId(origin)]}).catch(() => undefined);
  await setOrigins((await getOrigins()).filter((value) => value !== origin));
  await chrome.permissions.remove({origins: [originPattern(origin)]});
}

async function stageDraft(request, sender) {
  const tabUrl = sender.tab?.url;
  if (!tabUrl) return {status: 'ignored'};
  const origin = new URL(tabUrl).origin;
  if (!(await getOrigins()).includes(origin)) return {status: 'denied'};
  const text = String(request.text || '').slice(0, 100000);
  if (text.trim().length < 3) return {status: 'ignored'};

  const stored = await chrome.storage.session.get(SESSION_DRAFTS_KEY);
  const drafts = Array.isArray(stored[SESSION_DRAFTS_KEY]) ? stored[SESSION_DRAFTS_KEY] : [];
  drafts.unshift({
    id: crypto.randomUUID(),
    origin,
    reason: String(request.reason || 'unknown'),
    fieldKind: String(request.fieldKind || 'unknown'),
    text,
    updatedAt: new Date().toISOString(),
  });
  await chrome.storage.session.set({[SESSION_DRAFTS_KEY]: drafts.slice(0, MAX_SESSION_DRAFTS)});
  return {status: 'staged'};
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const operation = (async () => {
    switch (request?.action) {
      case 'enable_origin':
        await enableOrigin(String(request.origin));
        return {status: 'enabled'};
      case 'disable_origin':
        await disableOrigin(String(request.origin));
        return {status: 'disabled'};
      case 'origin_status':
        return {enabled: (await getOrigins()).includes(String(request.origin))};
      case 'clear_session_drafts':
        await chrome.storage.session.remove(SESSION_DRAFTS_KEY);
        return {status: 'cleared'};
      case 'stage_draft':
        return stageDraft(request, sender);
      default:
        return {status: 'ignored'};
    }
  })();
  operation.then(sendResponse, (error) => sendResponse({status: 'error', message: error.message}));
  return true;
});

chrome.runtime.onStartup.addListener(async () => {
  for (const origin of await getOrigins()) await registerOrigin(origin).catch(() => undefined);
});
