import {
  test,
  expect,
  watchForErrors,
  stagedDrafts,
} from './extension.mjs';

async function enable(worker, origin) {
  const result = await worker.evaluate(
    (value) => enableOrigin(value).then(() => 'enabled', (error) => `error: ${error.message}`),
    origin,
  );
  expect(result).toBe('enabled');
}

function editAndBlur(page, selector, text) {
  return page.locator(selector).evaluate((element, value) => {
    element.focus();
    element.value = value;
    element.dispatchEvent(new Event('input', {bubbles: true}));
    element.blur();
  }, text);
}

test('Unicode and invisible obfuscation cannot bypass the real capture wiring', async ({
  page,
  worker,
  fixtureServer,
}) => {
  const errors = [];
  watchForErrors(page, errors);
  const origin = fixtureServer.enabledOrigin;

  await enable(worker, origin);
  await page.goto(`${origin}/unicode.html`);

  const protectedEdits = [
    ['#fullwidth-secret', 'fullwidth-recovery-secret'],
    ['#zero-width-secret', 'zero-width-password-secret'],
    ['#separator-secret', 'separator-seed-secret'],
    ['#autocomplete-secret', 'autocomplete-otp-secret'],
  ];
  for (const [selector, secret] of protectedEdits) {
    await editAndBlur(page, selector, secret);
  }

  await page.fill('#canary', 'ordinary meeting note');
  await page.click('#elsewhere');
  await expect.poll(() => stagedDrafts(worker)).toHaveLength(1);

  const drafts = await stagedDrafts(worker);
  expect(drafts.map((draft) => draft.text)).toEqual(['ordinary meeting note']);
  for (const [selector, secret] of protectedEdits) {
    expect(JSON.stringify(drafts), `${selector} must remain protected`).not.toContain(secret);
  }
  expect(errors).toEqual([]);
});
