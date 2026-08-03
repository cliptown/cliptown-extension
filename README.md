# ClipTown browser extension

Consent-based local draft recovery for selected web origins.

## Current safety boundary

- No site is captured until the user grants permission for that exact HTTP or HTTPS origin.
- Content scripts are registered dynamically after consent; there is no declared `<all_urls>` content script.
- Managed `captureDeniedOrigins` policy overrides stored user consent and prevents script registration after browser restart.
- Password, payment-card, one-time-code, passcode, identity, banking, private-key, seed-phrase, recovery-code, and authenticator fields are excluded, as are disabled, read-only, and unsupported input fields.
- Sensitive classification examines the field's name, id, placeholder, title, ARIA label, `aria-labelledby` nodes, associated `<label>` elements, and parent `<label>` text.
- Sensitive wording is normalized with Unicode NFKC, invisible/control characters are removed, and separators are compacted before matching, so full-width or zero-width-obfuscated labels cannot bypass the policy.
- Pages can opt sensitive editors or whole editor containers out with `data-cliptown-ignore` or `data-private`; descendants inherit the exclusion through `closest()`.
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
- protected autocomplete values, labels, placeholders, titles, associated labels, ARIA references, ancestor exclusion markers, and unexpected metadata;
- Unicode full-width, zero-width, control-character, and separator-obfuscation attempts.

These checks are defense in depth. Persistent encrypted recovery, authenticated sync, audit events, and store publication remain separate gated work.

## Validation

```sh
npm run check
```

CI validates Manifest V3 permissions, referenced files, JavaScript syntax, foreground and background privacy policies, protected-field tests, and the packaged ZIP contents. The package job uses immutable Actions, read-only permissions, exact Node.js, deterministic file timestamps and ordering, credential-marker scanning, a SHA-256 manifest, and retained archive inventory evidence.
