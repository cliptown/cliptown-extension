(function attachBackgroundPolicy(root, factory) {
  const policy = factory();
  root.ClipTownBackgroundPolicy = policy;
  if (typeof module === 'object' && module.exports) module.exports = policy;
})(globalThis, function createBackgroundPolicy() {
  const MAX_DRAFT_CHARS = 100000;
  const MAX_SESSION_DRAFTS = 20;
  const RATE_LIMIT_WINDOW_MS = 60000;
  const MAX_DRAFTS_PER_ORIGIN_WINDOW = 12;
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

  function effectiveOrigins(enabledOrigins, deniedOrigins = []) {
    const denied = new Set(normalizeOrigins(deniedOrigins));
    return normalizeOrigins(enabledOrigins).filter((origin) => !denied.has(origin));
  }

  function addOrigin(origins, value, deniedOrigins = []) {
    const origin = normalizeWebOrigin(value);
    if (!origin || normalizeOrigins(deniedOrigins).includes(origin)) {
      return normalizeOrigins(origins);
    }
    return normalizeOrigins([...normalizeOrigins(origins), origin]);
  }

  function removeOrigin(origins, value) {
    const origin = normalizeWebOrigin(value);
    if (!origin) return normalizeOrigins(origins);
    return normalizeOrigins(origins).filter((item) => item !== origin);
  }

  function draftCandidate(request, sender, allowedOrigins, deniedOrigins = []) {
    if (sender?.tab?.incognito === true) return {status: 'denied', reason: 'incognito'};

    const origin = normalizeWebOrigin(sender?.tab?.url);
    if (!origin) return {status: 'ignored', reason: 'unsupported-origin'};
    if (normalizeOrigins(deniedOrigins).includes(origin)) {
      return {status: 'denied', reason: 'managed-policy'};
    }
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

  function normalizeRateEvents(events, nowMs) {
    const now = Number(nowMs);
    if (!Array.isArray(events) || !Number.isFinite(now)) return [];
    const earliest = now - RATE_LIMIT_WINDOW_MS;
    return events.flatMap((event) => {
      const origin = normalizeWebOrigin(event?.origin);
      const at = Number(event?.at);
      if (!origin || !Number.isFinite(at) || at <= earliest || at > now) return [];
      return [{origin, at}];
    });
  }

  function rateLimitDecision(events, value, nowMs) {
    const origin = normalizeWebOrigin(value);
    const active = normalizeRateEvents(events, nowMs);
    if (!origin) return {allowed: false, events: active};
    const count = active.filter((event) => event.origin === origin).length;
    if (count >= MAX_DRAFTS_PER_ORIGIN_WINDOW) {
      return {allowed: false, events: active};
    }
    return {
      allowed: true,
      events: [...active, {origin, at: Number(nowMs)}],
    };
  }

  function clearOriginRecords(records, value) {
    const origin = normalizeWebOrigin(value);
    if (!origin || !Array.isArray(records)) return Array.isArray(records) ? records : [];
    return records.filter((record) => normalizeWebOrigin(record?.origin) !== origin);
  }

  return {
    MAX_DRAFT_CHARS,
    MAX_SESSION_DRAFTS,
    RATE_LIMIT_WINDOW_MS,
    MAX_DRAFTS_PER_ORIGIN_WINDOW,
    normalizeWebOrigin,
    normalizeOrigins,
    effectiveOrigins,
    addOrigin,
    removeOrigin,
    draftCandidate,
    prependBoundedDraft,
    normalizeRateEvents,
    rateLimitDecision,
    clearOriginRecords,
  };
});
