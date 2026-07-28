importScripts('background-policy.js');

const ORIGINS_KEY = 'captureOrigins';
const ADMIN_DENIED_ORIGINS_KEY = 'captureDeniedOrigins';
const SESSION_DRAFTS_KEY = 'sessionDrafts';
const RATE_EVENTS_KEY = 'draftRateEvents';
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

async function getManagedDeniedOrigins() {
  if (!chrome.storage.managed) return [];
  const stored = await chrome.storage.managed
    .get(ADMIN_DENIED_ORIGINS_KEY)
    .catch(() => ({}));
  return policy.normalizeOrigins(stored[ADMIN_DENIED_ORIGINS_KEY]);
}

async function getEffectiveOrigins() {
  return policy.effectiveOrigins(await getOrigins(), await getManagedDeniedOrigins());
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

async function unregisterOrigin(origin) {
  const normalized = policy.normalizeWebOrigin(origin);
  if (!normalized) return;
  await chrome.scripting.unregisterContentScripts({ids: [scriptId(normalized)]}).catch(() => undefined);
}

async function enableOrigin(origin) {
  const normalized = policy.normalizeWebOrigin(origin);
  if (!normalized) throw new Error('only HTTP and HTTPS origins are supported');
  if ((await getManagedDeniedOrigins()).includes(normalized)) {
    throw new Error('origin is disabled by managed policy');
  }
  const allowed = await chrome.permissions.contains({origins: [originPattern(normalized)]});
  if (!allowed) throw new Error('origin permission was not granted');
  await setOrigins(policy.addOrigin(await getOrigins(), normalized));
  await registerOrigin(normalized);
}

async function disableOrigin(origin) {
  const normalized = policy.normalizeWebOrigin(origin);
  if (!normalized) return;
  await unregisterOrigin(normalized);
  await setOrigins(policy.removeOrigin(await getOrigins(), normalized));
  await chrome.permissions.remove({origins: [originPattern(normalized)]});
}

async function stageDraft(request, sender) {
  const deniedOrigins = await getManagedDeniedOrigins();
  const candidate = policy.draftCandidate(request, sender, await getOrigins(), deniedOrigins);
  if (candidate.status !== 'staged') return candidate;

  const rateState = await chrome.storage.session.get(RATE_EVENTS_KEY);
  const rate = policy.rateLimitDecision(
    rateState[RATE_EVENTS_KEY],
    candidate.draft.origin,
    Date.now(),
  );
  await chrome.storage.session.set({[RATE_EVENTS_KEY]: rate.events});
  if (!rate.allowed) return {status: 'denied', reason: 'rate-limited'};

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

async function clearOriginDrafts(origin) {
  const normalized = policy.normalizeWebOrigin(origin);
  if (!normalized) return {status: 'ignored'};
  const stored = await chrome.storage.session.get([SESSION_DRAFTS_KEY, RATE_EVENTS_KEY]);
  await chrome.storage.session.set({
    [SESSION_DRAFTS_KEY]: policy.clearOriginRecords(stored[SESSION_DRAFTS_KEY], normalized),
    [RATE_EVENTS_KEY]: policy.clearOriginRecords(stored[RATE_EVENTS_KEY], normalized),
  });
  return {status: 'cleared'};
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
        return {enabled: origin ? (await getEffectiveOrigins()).includes(origin) : false};
      }
      case 'clear_session_drafts':
        await chrome.storage.session.remove([SESSION_DRAFTS_KEY, RATE_EVENTS_KEY]);
        return {status: 'cleared'};
      case 'clear_origin_drafts':
        return clearOriginDrafts(request.origin);
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
  const stored = await getOrigins();
  const effective = new Set(await getEffectiveOrigins());
  for (const origin of stored) {
    if (effective.has(origin)) {
      await registerOrigin(origin).catch(() => undefined);
    } else {
      await unregisterOrigin(origin);
    }
  }
});
