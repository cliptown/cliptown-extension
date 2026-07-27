const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../policy.js');

function input(overrides = {}) {
  return {
    tagName: 'INPUT',
    type: 'text',
    value: 'recover this draft',
    autocomplete: '',
    name: '',
    id: '',
    disabled: false,
    readOnly: false,
    isContentEditable: false,
    ...overrides,
  };
}

test('allows ordinary opted-in text controls', () => {
  assert.equal(policy.extractDraft(input()), 'recover this draft');
  assert.equal(policy.extractDraft(input({tagName: 'TEXTAREA'})), 'recover this draft');
});

test('rejects password, payment, OTP, and identity fields', () => {
  assert.equal(policy.extractDraft(input({type: 'password'})), null);
  assert.equal(policy.extractDraft(input({autocomplete: 'cc-number'})), null);
  assert.equal(policy.extractDraft(input({autocomplete: 'one-time-code'})), null);
  assert.equal(policy.extractDraft(input({name: 'account_passcode'})), null);
  assert.equal(policy.extractDraft(input({id: 'cvv'})), null);
});

test('rejects disabled, read-only, unsupported, and tiny fields', () => {
  assert.equal(policy.extractDraft(input({disabled: true})), null);
  assert.equal(policy.extractDraft(input({readOnly: true})), null);
  assert.equal(policy.extractDraft(input({type: 'email'})), null);
  assert.equal(policy.extractDraft(input({value: 'x'})), null);
});

test('bounds staged plaintext before session handoff', () => {
  const draft = policy.extractDraft(input({value: 'a'.repeat(policy.MAX_DRAFT_CHARS + 50)}));
  assert.equal(draft.length, policy.MAX_DRAFT_CHARS);
});
