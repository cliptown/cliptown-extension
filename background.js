importScripts('background-policy.js');

const ORIGINS_KEY = 'captureOrigins';
const ADMIN_DENIED_ORIGINS_KEY = 'captureDeniedOrigins';
const SESSION_DRAFTS_KEY = 'sessionDrafts';
const RATE_EVENTS_KEY = 'draftRateEvents';
const SCRIPT_ID_PREFIX = 'cliptown_';
const policy = globalThis.ClipTownBackgroundPolicy;

if (!policy) throw new Error('ClipTown background privacy policy was not loaded');

// Drafts must never be readable from a content script, even if a future Chromium
// release changes the default session-storage access level.
chrome.storage.session.setAccessLevel?.({accessLevel: 'TRUSTED_CONTEXTS'}).catch(() => undefined);

// Session reads and writes are read-modify-write, so concurrent messages must not interleave.
let sessionQueue = Promise.resolve();
// Registration changes are also read-modify-write: a lifecycle re-sync must never
// race a user enable/disable and leave a stale or missing content script.
let registrationQueue = Promise.resolve();

function withSessionLock(task) {
  const result = sessionQueue.then(task, task);
  sessionQueue = result.then(() => undefined, () => undefined);
  return result;
}

function withRegistrationLock(task) {
  const result = registrationQueue.then(task, task);
  registrationQueue = result.then(() => undefined, () => undefined);
  return result;
}

function originPattern(origin) {
  return `${origin}/*`;
}

// Collision-free by construction: a hash would let two origins share one registration.
function scriptId(origin) {
  let encoded = '';
  for (const character of origin) encoded += character.codePointAt(0).toString(16).padStart(4, '0');
  return `${SCRIPT_ID_PREFIX}${encoded}`;
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

function enableOrigin(origin) {
  const normalized = policy.normalizeWebOrigin(origin);
  if (!normalized) throw new Error('only HTTP and HTTPS origins are supported');
  return withRegistrationLock(async () => {
    if ((await getManagedDeniedOrigins()).includes(normalized)) {
      throw new Error('origin is disabled by managed policy');
    }
    const allowed = await chrome.permissions.contains({origins: [originPattern(normalized)]});
    if (!allowed) throw new Error('origin permission was not granted');
    await setOrigins(policy.addOrigin(await getOrigins(), normalized));
    await registerOrigin(normalized);
  });
}

function disableOrigin(origin) {
  const normalized = policy.normalizeWebOrigin(origin);
  if (!normalized) return Promise.resolve();
  return withRegistrationLock(async () => {
    await unregisterOrigin(normalized);
    await setOrigins(policy.removeOrigin(await getOrigins(), normalized));
    await clearOriginDrafts(normalized);
    // Capture has already stopped; a failure to hand the host permission back
    // must not report the disable itself as failed.
    await chrome.permissions.remove({origins: [originPattern(normalized)]}).catch(() => undefined);
  });
}

function stageDraft(request, sender) {
  return withSessionLock(async () => {
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
  });
}

function clearOriginDrafts(origin) {
  const normalized = policy.normalizeWebOrigin(origin);
  if (!normalized) return Promise.resolve({status: 'ignored'});
  return withSessionLock(async () => {
    const stored = await chrome.storage.session.get([SESSION_DRAFTS_KEY, RATE_EVENTS_KEY]);
    await chrome.storage.session.set({
      [SESSION_DRAFTS_KEY]: policy.clearOriginRecords(stored[SESSION_DRAFTS_KEY], normalized),
      [RATE_EVENTS_KEY]: policy.clearOriginRecords(stored[RATE_EVENTS_KEY], normalized),
    });
    return {status: 'cleared'};
  });
}

// Only extension-owned pages (the popup) may change consent or read/clear staged drafts.
// A content script is untrusted for anything except offering its own draft.
function isTrustedExtensionPage(sender) {
  if (sender?.id !== chrome.runtime.id) return false;
  if (sender?.tab) return false;
  return typeof sender?.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const operation = (async () => {
    if (sender?.id !== chrome.runtime.id) return {status: 'ignored'};
    if (request?.action !== 'stage_draft' && !isTrustedExtensionPage(sender)) {
      return {status: 'denied', reason: 'untrusted-sender'};
    }
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
        await withSessionLock(() =>
          chrome.storage.session.remove([SESSION_DRAFTS_KEY, RATE_EVENTS_KEY]));
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

async function hasHostPermission(origin) {
  return chrome.permissions
    .contains({origins: [originPattern(origin)]})
    .catch(() => false);
}

// Single source of truth for "which origins may currently have a content script".
// Runs on startup, on install/update, when managed policy changes, and when the
// user revokes a host permission from chrome://extensions.
function syncRegistrations() {
  return withRegistrationLock(async () => {
    const stored = await getOrigins();
    const denied = new Set(await getManagedDeniedOrigins());

    const stillGranted = [];
    for (const origin of stored) {
      if (await hasHostPermission(origin)) stillGranted.push(origin);
    }
    // A revoked host permission is an explicit withdrawal of consent, so forget it.
    if (stillGranted.length !== stored.length) await setOrigins(stillGranted);

    const wanted = new Map(
      stillGranted
        .filter((origin) => !denied.has(origin))
        .map((origin) => [scriptId(origin), origin]),
    );

    const registered = await chrome.scripting.getRegisteredContentScripts().catch(() => []);
    const stale = registered
      .map((script) => script?.id)
      .filter((id) => typeof id === 'string' && id.startsWith(SCRIPT_ID_PREFIX) && !wanted.has(id));
    if (stale.length) {
      await chrome.scripting.unregisterContentScripts({ids: stale}).catch(() => undefined);
    }

    for (const origin of wanted.values()) await registerOrigin(origin).catch(() => undefined);

    // Managed denial must not leave already-staged plaintext behind.
    for (const origin of stored) {
      if (denied.has(origin)) await clearOriginDrafts(origin);
    }
  });
}

chrome.runtime.onStartup.addListener(() => {
  syncRegistrations().catch(() => undefined);
});

chrome.runtime.onInstalled.addListener(() => {
  syncRegistrations().catch(() => undefined);
});

chrome.permissions.onRemoved.addListener(() => {
  syncRegistrations().catch(() => undefined);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'managed' || !changes[ADMIN_DENIED_ORIGINS_KEY]) return;
  syncRegistrations().catch(() => undefined);
});
