import {readFileSync, existsSync} from 'node:fs';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const fail = (message) => { throw new Error(message); };

if (manifest.manifest_version !== 3) fail('Manifest V3 is required');
if (!/^0\./.test(manifest.version)) fail('pre-release extension must use a 0.x version');

const permissions = new Set(manifest.permissions ?? []);
for (const forbidden of ['clipboardRead', 'clipboardWrite', 'webRequest', 'webRequestBlocking']) {
  if (permissions.has(forbidden)) fail(`forbidden permission: ${forbidden}`);
}
if (manifest.host_permissions?.length) fail('host access must be optional and origin-specific');
if ((manifest.content_scripts ?? []).length) fail('content scripts must be dynamically registered after consent');

const optionalOrigins = manifest.optional_host_permissions ?? [];
if (!optionalOrigins.includes('https://*/*') || !optionalOrigins.includes('http://*/*')) {
  fail('optional host permission patterns are missing');
}
if (optionalOrigins.some((origin) => !['http://*/*', 'https://*/*'].includes(origin))) {
  fail('optional host permissions must be limited to HTTP and HTTPS');
}

for (const file of [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  'background-policy.js',
  'background.js',
  'content.js',
  'policy.js',
  'popup.js',
]) {
  if (!file || !existsSync(file)) fail(`missing referenced extension file: ${file}`);
}

const sources = ['background-policy.js', 'background.js', 'content.js', 'policy.js', 'popup.js']
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');
const background = readFileSync('background.js', 'utf8');
const capturePolicy = readFileSync('policy.js', 'utf8');

if (/console\.log\s*\(/.test(sources)) fail('plaintext console logging is forbidden');
if (/<all_urls>/.test(sources) || /save_draft/.test(sources)) fail('legacy unconditional capture code remains');
if (!/storage\.session/.test(sources)) fail('drafts must remain session-scoped until encrypted persistence exists');
if (!/importScripts\(['"]background-policy\.js['"]\)/.test(background)) {
  fail('background worker must load the reviewed background privacy policy');
}
if (!/incognito/.test(sources)) fail('incognito capture must be explicitly rejected');
if (!/normalizeWebOrigin/.test(sources)) fail('background origin handling must be normalized and protocol-bounded');
if (!/MAX_SESSION_DRAFTS/.test(sources)) fail('session retention must remain explicitly bounded');
if (!/untrusted-sender/.test(background)) {
  fail('privileged background actions must reject content-script senders');
}
if (!/TRUSTED_CONTEXTS/.test(background)) {
  fail('staged drafts must stay restricted to trusted extension contexts');
}
if (!/permissions\.onRemoved/.test(background)) {
  fail('revoked host permissions must unregister capture');
}
if (!/closest/.test(capturePolicy)) {
  fail('capture policy must honor exclusion markers on ancestor elements');
}
if (!/labels/.test(capturePolicy) || !/aria-labelledby/.test(capturePolicy)) {
  fail('capture policy must inspect the label a user actually sees');
}

console.log('Extension manifest and privacy contract validated.');
