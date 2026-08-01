import {test, expect, stagedDrafts} from './extension.mjs';

test('probe: worker boots and origin can be enabled', async ({page, worker, fixtureServer}) => {
  const origin = fixtureServer.enabledOrigin;
  const result = await worker.evaluate((o) => enableOrigin(o).then(() => 'ok', (e) => e.message), origin);
  expect(result).toBe('ok');
  const scripts = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  console.log('registered', JSON.stringify(scripts));
  await page.goto(`${origin}/form.html`);
  await page.fill('#notes', 'hello probe draft');
  await page.click('#elsewhere');
  await expect.poll(() => stagedDrafts(worker)).toHaveLength(1);
  console.log('drafts', JSON.stringify(await stagedDrafts(worker)));
});
