const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../background-policy.js');

function sender(url = 'https://example.com/editor', overrides = {}) {
  return {
    tab: {
      url,
      incognito: false,
      ...overrides,
    },
  };
}

function request(overrides = {}) {
  return {
    text: 'recover this draft',
    reason: 'idle',
    fieldKind: 'textarea',
    ...overrides,
  };
}

test('normalizes only credential-free HTTP and HTTPS origins', () => {
  assert.equal(policy.normalizeWebOrigin('https://Example.COM/path?q=1'), 'https://example.com');
  assert.equal(policy.normalizeWebOrigin('http://localhost:8080/editor'), 'http://localhost:8080');
  assert.equal(policy.normalizeWebOrigin('https://user:secret@example.com/editor'), null);
  assert.equal(policy.normalizeWebOrigin('ftp://example.com/file'), null);
  assert.equal(policy.normalizeWebOrigin('chrome://settings'), null);
  assert.equal(policy.normalizeWebOrigin('file:///tmp/draft.txt'), null);
  assert.equal(policy.normalizeWebOrigin('not a URL'), null);
});

test('deduplicates, sorts, and drops unsupported stored origins', () => {
  assert.deepEqual(
    policy.normalizeOrigins([
      'https://b.example/path',
      'file:///tmp/draft',
      'https://a.example',
      'https://b.example',
      null,
    ]),
    ['https://a.example', 'https://b.example'],
  );
});

test('managed deny rules override stored consent and restart registration', () => {
  const stored = ['https://allowed.example', 'https://blocked.example/path'];
  const denied = ['https://blocked.example'];
  assert.deepEqual(policy.effectiveOrigins(stored, denied), ['https://allowed.example']);
  assert.deepEqual(policy.addOrigin(stored, 'https://blocked.example/editor', denied), [
    'https://allowed.example',
    'https://blocked.example',
  ]);
});

test('origin disable and re-enable operations remain normalized and deterministic', () => {
  const enabled = policy.addOrigin([], 'https://Example.com/editor');
  assert.deepEqual(enabled, ['https://example.com']);
  assert.deepEqual(policy.removeOrigin(enabled, 'https://example.com/other'), []);
  assert.deepEqual(policy.addOrigin([], 'file:///tmp/draft'), []);
});

test('rejects incognito senders even when the origin is enabled', () => {
  assert.deepEqual(
    policy.draftCandidate(
      request(),
      sender('https://example.com/editor', {incognito: true}),
      ['https://example.com'],
    ),
    {status: 'denied', reason: 'incognito'},
  );
});

test('rejects unsupported, navigated, non-enabled, and managed origins', () => {
  assert.deepEqual(
    policy.draftCandidate(request(), sender('chrome://settings'), ['https://example.com']),
    {status: 'ignored', reason: 'unsupported-origin'},
  );
  assert.deepEqual(
    policy.draftCandidate(request(), sender('https://other.example/editor'), ['https://example.com']),
    {status: 'denied', reason: 'origin-not-enabled'},
  );
  assert.deepEqual(
    policy.draftCandidate(
      request(),
      sender('https://example.com/editor'),
      ['https://example.com'],
      ['https://example.com'],
    ),
    {status: 'denied', reason: 'managed-policy'},
  );
});

test('stages bounded drafts with normalized metadata for enabled origins', () => {
  const result = policy.draftCandidate(
    request({
      text: 'a'.repeat(policy.MAX_DRAFT_CHARS + 50),
      reason: 'unexpected-reason',
      fieldKind: 'custom-editor',
    }),
    sender(),
    ['https://example.com'],
  );

  assert.equal(result.status, 'staged');
  assert.equal(result.draft.origin, 'https://example.com');
  assert.equal(result.draft.reason, 'unknown');
  assert.equal(result.draft.fieldKind, 'unknown');
  assert.equal(result.draft.text.length, policy.MAX_DRAFT_CHARS);
});

test('accepts only the known capture reasons and field kinds', () => {
  for (const reason of ['idle', 'blur']) {
    for (const fieldKind of ['input', 'textarea', 'contenteditable']) {
      const result = policy.draftCandidate(
        request({reason, fieldKind}),
        sender(),
        ['https://example.com'],
      );
      assert.equal(result.status, 'staged');
      assert.equal(result.draft.reason, reason);
      assert.equal(result.draft.fieldKind, fieldKind);
    }
  }
});

test('ignores blank and tiny drafts before storage handoff', () => {
  for (const text of ['', ' ', 'x', ' x ']) {
    assert.deepEqual(
      policy.draftCandidate(request({text}), sender(), ['https://example.com']),
      {status: 'ignored', reason: 'empty'},
    );
  }
});

test('bounds session draft retention to the newest twenty records', () => {
  const existing = Array.from({length: 30}, (_, index) => ({id: `old-${index}`}));
  const result = policy.prependBoundedDraft(existing, {id: 'new'});
  assert.equal(result.length, policy.MAX_SESSION_DRAFTS);
  assert.equal(result[0].id, 'new');
  assert.equal(result.at(-1).id, 'old-18');
});

test('rate limits one origin without blocking another and expires old events', () => {
  const now = 1_000_000;
  let events = [];
  for (let index = 0; index < policy.MAX_DRAFTS_PER_ORIGIN_WINDOW; index += 1) {
    const decision = policy.rateLimitDecision(events, 'https://example.com', now - 1000 + index);
    assert.equal(decision.allowed, true);
    events = decision.events;
  }

  const limited = policy.rateLimitDecision(events, 'https://example.com', now);
  assert.equal(limited.allowed, false);
  assert.equal(
    policy.rateLimitDecision(events, 'https://other.example', now).allowed,
    true,
  );
  assert.equal(
    policy.rateLimitDecision(events, 'https://example.com', now + policy.RATE_LIMIT_WINDOW_MS + 1).allowed,
    true,
  );
});

test('clear-origin policy removes only matching session drafts and rate events', () => {
  const records = [
    {origin: 'https://example.com', id: 'a'},
    {origin: 'https://other.example', id: 'b'},
    {origin: 'https://example.com/path', id: 'c'},
  ];
  assert.deepEqual(policy.clearOriginRecords(records, 'https://example.com/editor'), [
    {origin: 'https://other.example', id: 'b'},
  ]);
  assert.deepEqual(policy.clearOriginRecords(undefined, 'https://example.com'), []);
});
