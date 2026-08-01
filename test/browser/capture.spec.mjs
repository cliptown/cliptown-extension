/**
 * Real-browser proof of the capture privacy boundary.
 *
 * Every assertion here runs against Chromium with the unpacked extension loaded,
 * the real dynamically registered content script, and the real background worker.
 * A unit test can assert these properties falsely if the content-script wiring
 * regresses; these cannot.
 */
import {
  test,
  expect,
  watchForErrors,
  stagedDrafts,
  sendFromContentScript,
  injectCaptureScripts,
  tabIdForUrl,
} from './extension.mjs';

const DEBOUNCE_MS = 1500;

/** Consent to an origin through the background worker's real enable path. */
async function enable(worker, origin) {
  const result = await worker.evaluate(
    (value) => enableOrigin(value).then(() => 'enabled', (error) => `error: ${error.message}`),
    origin,
  );
  expect(result).toBe('enabled');
}

/**
 * Force an input + blur on a field, even one a user could not type into.
 * Strictly more permissive than real typing, which makes every "not captured"
 * assertion below stronger rather than weaker.
 */
function editAndBlur(page, selector, text) {
  return page.locator(selector).evaluate((element, value) => {
    element.focus();
    if (element.isContentEditable) element.textContent = value;
    else element.value = value;
    element.dispatchEvent(new Event('input', {bubbles: true}));
    element.blur();
  }, text);
}

function draftTexts(drafts) {
  return drafts.map((draft) => draft.text);
}

test.describe('draft capture on a consented origin', () => {
  test('captures an ordinary textarea draft end to end', async ({page, worker, fixtureServer}) => {
    const errors = [];
    watchForErrors(page, errors);
    const origin = fixtureServer.enabledOrigin;

    await enable(worker, origin);
    await page.goto(`${origin}/form.html`);

    await page.fill('#notes', 'quarterly retro notes to recover');
    await page.click('#elsewhere');

    await expect.poll(() => stagedDrafts(worker)).toHaveLength(1);
    const [draft] = await stagedDrafts(worker);
    expect(draft).toMatchObject({
      origin,
      text: 'quarterly retro notes to recover',
      reason: 'blur',
      fieldKind: 'textarea',
    });
    expect(draft.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(errors).toEqual([]);
  });

  test('captures a contenteditable draft after the idle debounce', async ({
    page,
    worker,
    fixtureServer,
  }) => {
    const errors = [];
    watchForErrors(page, errors);
    const origin = fixtureServer.enabledOrigin;

    await enable(worker, origin);
    await page.goto(`${origin}/form.html`);

    await page.locator('#open-editor').fill('draft body kept in session memory');
    // No blur: this must be staged by the idle timer, not the blur handler.
    await page.waitForTimeout(DEBOUNCE_MS + 250);

    await expect.poll(() => stagedDrafts(worker)).toHaveLength(1);
    const [draft] = await stagedDrafts(worker);
    expect(draft).toMatchObject({
      origin,
      text: 'draft body kept in session memory',
      reason: 'idle',
      fieldKind: 'contenteditable',
    });
    expect(errors).toEqual([]);
  });

  test('drafts live only in storage.session, never in local or sync', async ({
    page,
    worker,
    fixtureServer,
  }) => {
    const origin = fixtureServer.enabledOrigin;
    await enable(worker, origin);
    await page.goto(`${origin}/form.html`);
    await page.fill('#notes', 'this text must never reach disk');
    await page.click('#elsewhere');
    await expect.poll(() => stagedDrafts(worker)).toHaveLength(1);

    const persisted = await worker.evaluate(async () => ({
      local: JSON.stringify(await chrome.storage.local.get(null)),
      sync: JSON.stringify(await chrome.storage.sync.get(null).catch(() => ({}))),
    }));
    expect(persisted.local).not.toContain('this text must never reach disk');
    expect(persisted.sync).not.toContain('this text must never reach disk');
    // Consent itself is the only thing allowed to persist.
    expect(JSON.parse(persisted.local).captureOrigins).toEqual([origin]);
  });
});

test.describe('protected fields are never captured', () => {
  // Each entry is [selector, secret, why it must be excluded].
  const PROTECTED_FIELDS = [
    ['#account-password', 'hunter2-real-password', 'input type=password'],
    ['#pin', '482913-recovery-secret', 'associated <label> reads "Recovery code"'],
    ['#aria-secret', '00123456789-account', 'aria-labelledby reads "Bank account number"'],
    ['#wrapped-card', '4111111111111111', 'wrapping <label> reads "Card number"'],
    ['#ignored', 'scratch pad private text', 'data-cliptown-ignore on the field'],
    ['#wrapped-editor', 'confidential board memo', 'data-private on an ancestor'],
    ['#phone', '+1-555-0100-secret', 'unsupported input type'],
    ['#readonly-note', 'archived readonly text', 'read-only field'],
  ];

  test('no protected or opted-out field reaches the background worker', async ({
    page,
    worker,
    fixtureServer,
  }) => {
    const errors = [];
    watchForErrors(page, errors);
    const origin = fixtureServer.enabledOrigin;

    await enable(worker, origin);
    await page.goto(`${origin}/form.html`);

    for (const [selector, secret] of PROTECTED_FIELDS) {
      await editAndBlur(page, selector, secret);
    }

    // The canary is an ordinary field edited last. Once its draft has been
    // staged, every message above has already been processed by the worker,
    // so "no protected draft" is an ordered fact rather than a timing guess.
    await page.fill('#canary', 'ordinary follow up note');
    await page.click('#elsewhere');
    await expect.poll(() => stagedDrafts(worker)).toHaveLength(1);

    const drafts = await stagedDrafts(worker);
    expect(draftTexts(drafts)).toEqual(['ordinary follow up note']);
    for (const [selector, secret, why] of PROTECTED_FIELDS) {
      expect(JSON.stringify(drafts), `${selector} must be excluded (${why})`).not.toContain(secret);
    }
    expect(errors).toEqual([]);
  });

  test('a protected field stays excluded even when it is the only edit', async ({
    page,
    worker,
    fixtureServer,
  }) => {
    const origin = fixtureServer.enabledOrigin;
    await enable(worker, origin);
    await page.goto(`${origin}/form.html`);

    await page.fill('#account-password', 'solo-password-secret');
    await page.click('#elsewhere');
    await page.waitForTimeout(DEBOUNCE_MS + 250);

    // Round-trip through the worker so a late message would already have landed.
    const tabId = await tabIdForUrl(worker, `${origin}/form.html`);
    expect(tabId).not.toBeNull();
    await sendFromContentScript(worker, tabId, {action: 'noop'});

    expect(await stagedDrafts(worker)).toEqual([]);
  });
});

test.describe('origins without consent capture nothing', () => {
  test('no content script is registered before consent is given', async ({
    page,
    worker,
    fixtureServer,
  }) => {
    const errors = [];
    watchForErrors(page, errors);
    const origin = fixtureServer.enabledOrigin;

    expect(await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts())).toEqual([]);

    await page.goto(`${origin}/form.html`);
    await page.fill('#notes', 'typed before any consent was given');
    await page.click('#elsewhere');
    await page.waitForTimeout(DEBOUNCE_MS + 250);

    expect(await stagedDrafts(worker)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('a denied origin is refused even with the capture script force-injected', async ({
    page,
    worker,
    fixtureServer,
  }) => {
    const errors = [];
    watchForErrors(page, errors);
    const {enabledOrigin, deniedOrigin} = fixtureServer;

    await enable(worker, enabledOrigin);
    await page.goto(`${deniedOrigin}/form.html`);

    const tabId = await tabIdForUrl(worker, `${deniedOrigin}/form.html`);
    expect(tabId).not.toBeNull();
    // The denied origin has no registered script; inject the real one anyway so
    // the background worker is the only thing standing between the page and storage.
    await injectCaptureScripts(worker, tabId);
    await editAndBlur(page, '#notes', 'draft from a non-consented origin');

    const response = await sendFromContentScript(worker, tabId, {
      action: 'stage_draft',
      reason: 'blur',
      text: 'draft from a non-consented origin',
      fieldKind: 'textarea',
    });
    expect(response).toEqual({status: 'denied', reason: 'origin-not-enabled'});
    expect(await stagedDrafts(worker)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('withdrawing consent stops an already-running content script', async ({
    page,
    worker,
    fixtureServer,
  }) => {
    const origin = fixtureServer.enabledOrigin;
    await enable(worker, origin);
    await page.goto(`${origin}/form.html`);

    await page.fill('#notes', 'captured while consent was active');
    await page.click('#elsewhere');
    await expect.poll(() => stagedDrafts(worker)).toHaveLength(1);

    await worker.evaluate((value) => disableOrigin(value), origin);
    expect(await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts())).toEqual([]);

    // The tab still has the previously injected script running.
    const tabId = await tabIdForUrl(worker, `${origin}/form.html`);
    await editAndBlur(page, '#notes', 'typed after consent was withdrawn');
    const response = await sendFromContentScript(worker, tabId, {
      action: 'stage_draft',
      reason: 'blur',
      text: 'typed after consent was withdrawn',
      fieldKind: 'textarea',
    });

    expect(response).toEqual({status: 'denied', reason: 'origin-not-enabled'});
    // Withdrawing consent also discards the plaintext already staged for that origin.
    expect(await stagedDrafts(worker)).toEqual([]);
  });
});

test.describe('content scripts cannot use privileged background actions', () => {
  test('a page content script cannot clear drafts or grant itself consent', async ({
    page,
    worker,
    fixtureServer,
  }) => {
    const {enabledOrigin, deniedOrigin} = fixtureServer;
    await enable(worker, enabledOrigin);
    await page.goto(`${enabledOrigin}/form.html`);
    await page.fill('#notes', 'draft owned by the user');
    await page.click('#elsewhere');
    await expect.poll(() => stagedDrafts(worker)).toHaveLength(1);

    const tabId = await tabIdForUrl(worker, `${enabledOrigin}/form.html`);
    for (const message of [
      {action: 'clear_session_drafts'},
      {action: 'clear_origin_drafts', origin: enabledOrigin},
      {action: 'enable_origin', origin: deniedOrigin},
      {action: 'disable_origin', origin: enabledOrigin},
    ]) {
      expect(await sendFromContentScript(worker, tabId, message), message.action).toEqual({
        status: 'denied',
        reason: 'untrusted-sender',
      });
    }

    // Nothing was cleared, nothing was enabled, nothing was disabled.
    expect(draftTexts(await stagedDrafts(worker))).toEqual(['draft owned by the user']);
    expect(await worker.evaluate(() => getEffectiveOrigins())).toEqual([enabledOrigin]);
  });
});

test.describe('popup', () => {
  test('renders its consent controls without console or page errors', async ({
    page,
    extensionId,
  }) => {
    const errors = [];
    watchForErrors(page, errors);

    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    await expect(page.locator('h1')).toHaveText('ClipTown draft recovery');
    await expect(page.locator('#enable')).toHaveText('Enable for this site');
    await expect(page.locator('#clear')).toHaveText('Clear session drafts');
    // Opened as a tab, the active tab is the popup itself, so it must refuse.
    await expect(page.locator('#status')).toHaveText('Open a normal http(s) page first.');
    expect(errors).toEqual([]);
  });
});
