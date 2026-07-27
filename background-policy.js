(function attachBackgroundPolicy(root, factory) {
  const policy = factory();
  root.ClipTownBackgroundPolicy = policy;
  if (typeof module === 'object' && module.exports) module.exports = policy;
})(globalThis, function createBackgroundPolicy() {
  const MAX_DRAFT_CHARS = 100000;
  const MAX_SESSION_DRAFTS = 20;
  const ALLOWED_REASONS = new Set(['idle', 'blur']);
  const ALLOWED_FIELD_KINDS = new Set(['input', 'textarea', 'contenteditable']);

  function normalizeWebOrigin(value) {
    try {
      const url = new URL(String(value || ''));
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      if (url.username || url.password) return null;
      return url.origin;
    } catch {
      return null;
    }
  }

  function normalizeOrigins(values) {
    if (!Array.isArray(values)) return [];
    return [...new Set(values.map(normalizeWebOrigin).filter(Boolean))].sort();
  }

  function draftCandidate(request, sender, allowedOrigins) {
    if (sender?.tab?.incognito === true) return {status: 'denied', reason: 'incognito'};

    const origin = normalizeWebOrigin(sender?.tab?.url);
    if (!origin) return {status: 'ignored', reason: 'unsupported-origin'};
    if (!normalizeOrigins(allowedOrigins).includes(origin)) {
      return {status: 'denied', reason: 'origin-not-enabled'};
    }

    const text = String(request?.text || '').slice(0, MAX_DRAFT_CHARS);
    if (text.trim().length < 3) return {status: 'ignored', reason: 'empty'};

    const requestedReason = String(request?.reason || '');
    const requestedFieldKind = String(request?.fieldKind || '');
    return {
      status: 'staged',
      draft: {
        origin,
        reason: ALLOWED_REASONS.has(requestedReason) ? requestedReason : 'unknown',
        fieldKind: ALLOWED_FIELD_KINDS.has(requestedFieldKind) ? requestedFieldKind : 'unknown',
        text,
      },
    };
  }

  function prependBoundedDraft(drafts, draft) {
    const current = Array.isArray(drafts) ? drafts : [];
    return [draft, ...current].slice(0, MAX_SESSION_DRAFTS);
  }

  return {
    MAX_DRAFT_CHARS,
    MAX_SESSION_DRAFTS,
    normalizeWebOrigin,
    normalizeOrigins,
    draftCandidate,
    prependBoundedDraft,
  };
});
