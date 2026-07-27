importScripts('background-policy.js');

const ORIGINS_KEY = 'captureOrigins';
const SESSION_DRAFTS_KEY = 'sessionDrafts';
const policy = globalThis.ClipTownBackgroundPolicy;

if (!policy) throw new Error('ClipTown background privacy policy was not loaded');

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
  return policy.normalizeOrigins(stored[ORIGINS_KEY]);
}

async function setOrigins(origins) {
  await chrome.storage.local.set({[ORIGINS_KEY]: policy.normalizeOrigins(origins)});
}

async function registerOrigin(origin) {
  const normalized = policy.normalizeWebOrigin(origin);
  if (!normalized) throw new Error('only HTTP and HTTPS origins are supported');
  const id = scriptId(normalized);
  await chrome.scripting.unregisterContentScripts({ids: [id]}).catch(() => undefined);
  await chrome.scripting.registerContentScripts([{
    id,
    matches: [originPattern(normalized)],
    js: ['policy.js', 'content.js'],
    runAt: 'document_idle',
    persistAcrossSessions: true,
  }]);
}

async function enableOrigin(origin) {
  const normalized = policy.normalizeWebOrigin(origin);
  if (!normalized) throw new Error('only HTTP and HTTPS origins are supported');
  const allowed = await chrome.permissions.contains({origins: [originPattern(normalized)]});
  if (!allowed) throw new Error('origin permission was not granted');
  const origins = await getOrigins();
  await setOrigins([...origins, normalized]);
  await registerOrigin(normalized);
}

async function disableOrigin(origin) {
  const normalized = policy.normalizeWebOrigin(origin);
  if (!normalized) return;
  await chrome.scripting.unregisterContentScripts({ids: [scriptId(normalized)]}).catch(() => undefined);
  await setOrigins((await getOrigins()).filter((value) => value !== normalized));
  await chrome.permissions.remove({origins: [originPattern(normalized)]});
}

async function stageDraft(request, sender) {
  const candidate = policy.draftCandidate(request, sender, await getOrigins());
  if (candidate.status !== 'staged') return candidate;

  const stored = await chrome.storage.session.get(SESSION_DRAFTS_KEY);
  const drafts = Array.isArray(stored[SESSION_DRAFTS_KEY]) ? stored[SESSION_DRAFTS_KEY] : [];
  const draft = {
    id: crypto.randomUUID(),
    ...candidate.draft,
    updatedAt: new Date().toISOString(),
  };
  await chrome.storage.session.set({
    [SESSION_DRAFTS_KEY]: policy.prependBoundedDraft(drafts, draft),
  });
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
      case 'origin_status': {
        const origin = policy.normalizeWebOrigin(request.origin);
        return {enabled: origin ? (await getOrigins()).includes(origin) : false};
      }
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
