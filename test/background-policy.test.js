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

test('rejects unsupported and non-enabled origins', () => {
  assert.deepEqual(
    policy.draftCandidate(request(), sender('chrome://settings'), ['https://example.com']),
    {status: 'ignored', reason: 'unsupported-origin'},
  );
  assert.deepEqual(
    policy.draftCandidate(request(), sender('https://other.example/editor'), ['https://example.com']),
    {status: 'denied', reason: 'origin-not-enabled'},
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
