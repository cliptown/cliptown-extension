/**
 * Playwright fixtures that launch a real Chromium with the UNPACKED extension.
 *
 * Consent boundary: the shipping manifest asks for host access through
 * `optional_host_permissions`, granted by `chrome.permissions.request()` from a
 * user gesture in the popup. That grant is a browser-native bubble and cannot be
 * driven by automation, so the harness copies the extension to a temp directory
 * and lists the two fixture origins under `host_permissions` instead. Nothing
 * else is modified: background.js, background-policy.js, content.js, policy.js,
 * popup.html and popup.js are the shipped files, and the tests still drive the
 * real `enableOrigin()` consent path, the real dynamic content-script
 * registration, and the real message boundary.
 */
import {test as base, expect} from '@playwright/test';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile, mkdtemp, writeFile, cp, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, join, normalize} from 'node:path';
import {tmpdir} from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const fixtureDir = join(here, '..', 'fixtures');

const EXTENSION_FILES = [
  'background-policy.js',
  'background.js',
  'content.js',
  'policy.js',
  'popup.html',
  'popup.js',
];

const CONTENT_TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8'};

async function startFixtureServer() {
  const server = createServer(async (request, response) => {
    const path = normalize(new URL(request.url, 'http://localhost').pathname).replace(/^(\.\.[/\\])+/, '');
    if (path === '/favicon.ico') {
      // Chromium requests this unprompted; a 404 would pollute console-error assertions.
      response.writeHead(204).end();
      return;
    }
    const file = join(fixtureDir, path === '/' ? 'form.html' : path);
    if (!file.startsWith(fixtureDir)) {
      response.writeHead(403).end('forbidden');
      return;
    }
    try {
      const body = await readFile(file);
      const extension = file.slice(file.lastIndexOf('.'));
      response.writeHead(200, {'content-type': CONTENT_TYPES[extension] ?? 'text/plain'}).end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address();
  return {
    port,
    enabledOrigin: `http://127.0.0.1:${port}`,
    deniedOrigin: `http://localhost:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** Copy the shipped extension, adding only the fixture origins as host permissions. */
async function buildUnpackedExtension(origins) {
  const directory = await mkdtemp(join(tmpdir(), 'cliptown-ext-'));
  for (const file of EXTENSION_FILES) {
    await cp(join(repoRoot, file), join(directory, file));
  }
  const manifest = JSON.parse(await readFile(join(repoRoot, 'manifest.json'), 'utf8'));
  manifest.host_permissions = origins.map((origin) => `${origin}/*`);
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return directory;
}

export const test = base.extend({
  fixtureServer: [
    async ({}, use) => {
      const server = await startFixtureServer();
      await use(server);
      await server.close();
    },
    {scope: 'worker'},
  ],

  context: async ({fixtureServer}, use, testInfo) => {
    const extensionDir = await buildUnpackedExtension([
      fixtureServer.enabledOrigin,
      fixtureServer.deniedOrigin,
    ]);
    const profileDir = await mkdtemp(join(tmpdir(), 'cliptown-profile-'));
    const context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chromium',
      headless: testInfo.project.use.headless ?? true,
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    await use(context);
    await context.close();
    await rm(extensionDir, {recursive: true, force: true});
    await rm(profileDir, {recursive: true, force: true});
  },

  /** The extension's MV3 service worker, used to drive real background functions. */
  worker: async ({context}, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    // The worker only counts as ready once the privacy policy module has attached.
    await expect
      .poll(() => worker.evaluate(() => typeof globalThis.ClipTownBackgroundPolicy))
      .toBe('object');
    await use(worker);
  },

  extensionId: async ({worker}, use) => {
    await use(new URL(worker.url()).host);
  },
});

export {expect};

/** Collect console errors and uncaught page errors for a page. */
export function watchForErrors(page, sink) {
  page.on('console', (message) => {
    if (message.type() === 'error') sink.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => sink.push(`pageerror: ${error.message}`));
}

/** Every draft the background worker currently holds in chrome.storage.session. */
export function stagedDrafts(worker) {
  return worker.evaluate(async () => {
    const stored = await chrome.storage.session.get('sessionDrafts');
    return Array.isArray(stored.sessionDrafts) ? stored.sessionDrafts : [];
  });
}

/**
 * Send a message to the background worker from a tab's content-script world,
 * exactly as content.js does, and return the background's real response.
 */
export function sendFromContentScript(worker, tabId, message) {
  return worker.evaluate(
    async ({tabId: id, message: payload}) => {
      const [result] = await chrome.scripting.executeScript({
        target: {tabId: id},
        world: 'ISOLATED',
        func: (body) => chrome.runtime.sendMessage(body),
        args: [payload],
      });
      return result.result;
    },
    {tabId, message},
  );
}

/** Inject the shipped capture policy + content script into a tab. */
export function injectCaptureScripts(worker, tabId) {
  return worker.evaluate(
    (id) => chrome.scripting.executeScript({target: {tabId: id}, files: ['policy.js', 'content.js']}),
    tabId,
  );
}

/** Chrome's tab id for a Playwright page, resolved through the extension's tabs API. */
export function tabIdForUrl(worker, url) {
  return worker.evaluate(async (target) => {
    const tabs = await chrome.tabs.query({url: target});
    return tabs[0]?.id ?? null;
  }, url);
}
