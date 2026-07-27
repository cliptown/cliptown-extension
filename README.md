# ClipTown browser extension

Consent-based local draft recovery for selected web origins.

## Current safety boundary

- No site is captured until the user grants permission for that exact HTTP or HTTPS origin.
- Content scripts are registered dynamically after consent; there is no declared `<all_urls>` content script.
- Password, payment-card, one-time-code, passcode, disabled, read-only, and unsupported input fields are excluded.
- Incognito tab senders are rejected again at the background-worker boundary, even if the user previously enabled the same ordinary origin.
- Credential-bearing, malformed, browser-internal, file, FTP, and other non-web origins are rejected.
- Draft reason and field-kind metadata are limited to reviewed values; unknown metadata is normalized rather than trusted.
- Plaintext is bounded to 100,000 characters and session retention is capped at the newest 20 drafts.
- Drafts are staged only in `chrome.storage.session`.
- Plaintext drafts are not logged, persisted to disk, or synchronized while end-device encryption is unfinished.

The extension must not add persistent or remote storage until `cliptown-clients` exposes reviewed TypeScript encryption and authenticated sync integration.

## Privacy regression matrix

The pure background policy tests cover:

- HTTP/HTTPS normalization and exact-origin comparison;
- rejection of credential-bearing and unsupported URLs;
- rejection of incognito senders;
- denial for non-enabled origins;
- bounded plaintext and session retention;
- known idle/blur reasons and input/textarea/contenteditable field kinds;
- normalization of unexpected metadata.

These checks are defense in depth. The content-script protected-field policy remains a separate gate and is also tested.

## Validation

```sh
npm run check
```

CI validates Manifest V3 permissions, referenced files, JavaScript syntax, foreground and background privacy policies, protected-field tests, and the packaged ZIP contents.
