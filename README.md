# ClipTown browser extension

Consent-based local draft recovery for selected web origins.

## Current safety boundary

- No site is captured until the user grants permission for that exact HTTP or HTTPS origin.
- Content scripts are registered dynamically after consent; there is no declared `<all_urls>` content script.
- Managed `captureDeniedOrigins` policy overrides stored user consent and prevents script registration after browser restart.
- Password, payment-card, one-time-code, passcode, identity, banking, private-key, seed-phrase, and recovery-code fields are excluded, as are disabled, read-only, and unsupported input fields.
- Exclusion is decided from the label a user actually sees: the field's `name`, `id`, `aria-label`, `placeholder` and `title`, plus its associated `<label>` elements, any wrapping `<label>`, and any `aria-labelledby` targets.
- Pages can opt sensitive editors out with `data-cliptown-ignore` or `data-private`, on the field itself **or on any ancestor**, so a wrapped rich-text editor can be excluded as a whole.
- Only the extension's own pages may change consent or read/clear staged drafts; a content script that asks for a privileged action is refused as an untrusted sender.
- Drafts are attributed to the origin of the document that sent them; a frame/tab origin mismatch or a subframe sender is refused.
- Disabling an origin, or an administrator denying it, discards the plaintext already staged for that origin.
- Capture registration is re-synchronised on startup, on install/update, when managed policy changes, and when a host permission is revoked from `chrome://extensions`.
- Incognito tab senders are rejected again at the background-worker boundary, even if the user previously enabled the same ordinary origin.
- Credential-bearing, malformed, browser-internal, file, FTP, and other non-web origins are rejected.
- Navigation never inherits consent: every staged message is checked against the sender tab's current exact origin.
- Draft reason and field-kind metadata are limited to reviewed values; unknown metadata is normalized rather than trusted.
- Plaintext is bounded to 100,000 characters and session retention is capped at the newest 20 drafts.
- Each origin is limited to 12 staged drafts in a rolling 60-second window.
- Drafts and rate-limit state are staged only in `chrome.storage.session`; users can clear all session drafts or one origin's drafts.
- Plaintext drafts are not logged, persisted to disk, or synchronized while end-device encryption is unfinished.

The extension must not add persistent or remote storage until `cliptown-clients` exposes reviewed TypeScript encryption and authenticated sync integration.

## Managed policy

Administrators may provide an array of exact HTTP/HTTPS origins through the managed-storage key `captureDeniedOrigins`. Managed denial is fail-closed at enablement, message staging, origin status, and browser-startup script registration. It does not grant access to any origin and requires no additional extension permission.

## Privacy regression matrix

The pure foreground and background policy tests cover:

- HTTP/HTTPS normalization and exact-origin comparison;
- rejection of credential-bearing and unsupported URLs;
- rejection of incognito senders;
- denial for non-enabled and managed origins;
- navigation to a different origin after consent;
- deterministic disable/re-enable and restart registration state;
- rolling per-origin rate limits without cross-origin interference;
- per-origin deletion of session drafts and rate events;
- bounded plaintext and session retention;
- known idle/blur reasons and input/textarea/contenteditable field kinds;
- protected labels, placeholders, page exclusion markers, and unexpected metadata.

These checks are defense in depth. Persistent encrypted recovery, authenticated sync, audit events, and store publication remain separate gated work.

## Real-browser privacy tests

The pure policy tests above prove the rules; they cannot prove the extension is wired to them.
`test/browser/capture.spec.mjs` launches Chromium with the unpacked extension in a Playwright
persistent context, against a static fixture form served over HTTP from `test/fixtures/`, and
asserts against the live `chrome.storage.session` contents that:

- an ordinary textarea is captured on blur and an ordinary contenteditable on the idle debounce;
- staged plaintext never appears in `chrome.storage.local` or `chrome.storage.sync`;
- a password field, a field protected only by its associated `<label>`, one protected only by
  `aria-labelledby`, one protected only by a wrapping `<label>`, a `data-cliptown-ignore` field, a
  `data-private` **ancestor**, an unsupported input type, and a read-only field all stage nothing,
  while an ordinary field edited afterwards does stage — so the negative result is ordered, not timed;
- no content script exists before consent, and an origin without consent stages nothing even when
  the real capture scripts are force-injected into it;
- withdrawing consent stops an already-running content script and discards its staged drafts;
- a content script cannot clear drafts, grant consent, or revoke consent;
- the popup renders its controls with no console or page errors.

Because `chrome.permissions.request()` is a browser-native prompt that automation cannot click, the
harness copies the extension to a temp directory and lists the two fixture origins under
`host_permissions`; every other file, and the whole consent/registration/staging path, is the
shipped code. Managed-policy denial is covered by the unit tests only, because `chrome.storage.managed`
is fed by enterprise policy files that cannot be provisioned hermetically in CI.

## Validation

```sh
npm ci
npm run check       # syntax, manifest, privacy contract, unit tests
npx playwright install --with-deps chromium
npm run test:browser  # real Chromium with the unpacked extension
```

CI validates Manifest V3 permissions, referenced files, JavaScript syntax, foreground and background
privacy policies, protected-field tests, the packaged ZIP contents, and the real-browser privacy
suite on every push and pull request.
