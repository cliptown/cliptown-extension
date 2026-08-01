const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../policy.js');

function input(overrides = {}) {
  return {
    tagName: 'INPUT',
    type: 'text',
    value: 'recover this draft',
    innerText: 'recover this draft',
    autocomplete: '',
    name: '',
    id: '',
    ariaLabel: '',
    placeholder: '',
    dataset: {},
    disabled: false,
    readOnly: false,
    isContentEditable: false,
    getAttribute() {
      return null;
    },
    ...overrides,
  };
}

test('allows ordinary opted-in text and contenteditable controls', () => {
  assert.equal(policy.extractDraft(input()), 'recover this draft');
  assert.equal(policy.extractDraft(input({tagName: 'TEXTAREA'})), 'recover this draft');
  assert.equal(
    policy.extractDraft(input({tagName: 'DIV', isContentEditable: true})),
    'recover this draft',
  );
});

test('rejects password, payment, OTP, identity, banking, and recovery fields', () => {
  assert.equal(policy.extractDraft(input({type: 'password'})), null);
  assert.equal(policy.extractDraft(input({autocomplete: 'cc-number'})), null);
  assert.equal(policy.extractDraft(input({autocomplete: 'one-time-code'})), null);
  assert.equal(policy.extractDraft(input({name: 'account_passcode'})), null);
  assert.equal(policy.extractDraft(input({id: 'cvv'})), null);
  assert.equal(policy.extractDraft(input({ariaLabel: 'Social Security Number'})), null);
  assert.equal(policy.extractDraft(input({placeholder: 'Bank routing number'})), null);
  assert.equal(policy.extractDraft(input({name: 'wallet_seed_phrase'})), null);
  assert.equal(policy.extractDraft(input({id: 'recovery-code'})), null);
});

test('honors page and administrator exclusion markers', () => {
  assert.equal(
    policy.extractDraft(input({dataset: {cliptownIgnore: ''}})),
    null,
  );
  assert.equal(policy.extractDraft(input({dataset: {private: 'true'}})), null);
  assert.equal(
    policy.extractDraft(input({
      tagName: 'DIV',
      isContentEditable: true,
      getAttribute(name) {
        return name === 'data-cliptown-ignore' ? '' : null;
      },
    })),
    null,
  );
});

test('excludes fields protected by their visible label rather than their attributes', () => {
  assert.equal(
    policy.extractDraft(input({labels: [{textContent: 'Recovery code'}]})),
    null,
  );
  assert.equal(
    policy.extractDraft(input({
      closest: (selector) => (selector === 'label' ? {textContent: 'Card number'} : null),
    })),
    null,
  );
  assert.equal(
    policy.extractDraft(input({
      getAttribute: (name) => (name === 'aria-labelledby' ? 'bank-label' : null),
      ownerDocument: {
        getElementById: (id) => (id === 'bank-label' ? {textContent: 'Bank account number'} : null),
      },
    })),
    null,
  );
  assert.equal(policy.extractDraft(input({title: 'Enter your password'})), null);
  assert.equal(
    policy.extractDraft(input({labels: [{textContent: 'Message notes'}]})),
    'recover this draft',
  );
});

test('honors exclusion markers placed on an ancestor of the editor', () => {
  assert.equal(
    policy.extractDraft(input({
      tagName: 'DIV',
      isContentEditable: true,
      closest: (selector) => (selector === '[data-private]' ? {} : null),
    })),
    null,
  );
  assert.equal(
    policy.extractDraft(input({
      closest: (selector) => (selector === '[data-cliptown-ignore]' ? {} : null),
    })),
    null,
  );
  assert.equal(policy.extractDraft(input({closest: () => null})), 'recover this draft');
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
