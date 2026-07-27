# ClipTown browser extension

Consent-based local draft recovery for selected web origins.

## Current safety boundary

- No site is captured until the user grants permission for that exact origin.
- Content scripts are registered dynamically after consent; there is no declared `<all_urls>` content script.
- Password, payment-card, one-time-code, passcode, disabled, read-only, and unsupported input fields are excluded.
- Drafts are bounded and staged only in `chrome.storage.session`.
- Plaintext drafts are not logged, persisted to disk, or synchronized while end-device encryption is unfinished.

The extension must not add persistent or remote storage until `cliptown-clients` exposes reviewed TypeScript encryption and authenticated sync integration.

## Validation

```sh
npm run check
```

CI validates Manifest V3 permissions, referenced files, JavaScript syntax, protected-field policy tests, and the packaged ZIP contents.
