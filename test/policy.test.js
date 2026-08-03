const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../policy.js');

function input(overrides = {}) {
  const attributes = overrides.attributes || {};
  const element = {
    tagName: 'INPUT',
    type: 'text',
    value: 'recover this draft',
    innerText: 'recover this draft',
    autocomplete: '',
    name: '',
    id: '',
    ariaLabel: '',
    placeholder: '',
    title: '',
    labels: [],
    ownerDocument: null,
    dataset: {},
    disabled: false,
    readOnly: false,
    isContentEditable: false,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name)
        ? attributes[name]
        : null;
    },
    closest() {
      return null;
    },
    ...overrides,
  };
  delete element.attributes;
  return element;
}

test('allows ordinary opted-in text and contenteditable controls', () => {
  assert.equal(policy.extractDraft(input()), 'recover this draft');
  assert.equal(policy.extractDraft(input({tagName: 'TEXTAREA'})), 'recover this draft');
  assert.equal(
    policy.extractDraft(input({tagName: 'DIV', isContentEditable: true})),
    'recover this draft',
  );
  assert.equal(
    policy.extractDraft(input({labels: [{textContent: 'Meeting notes'}]})),
    'recover this draft',
  );
});

test('rejects password, payment, OTP, identity, banking, and recovery fields', () => {
  assert.equal(policy.extractDraft(input({type: 'password'})), null);
  assert.equal(policy.extractDraft(input({autocomplete: 'cc-number'})), null);
  assert.equal(policy.extractDraft(input({autocomplete: 'one-time-code'})), null);
  assert.equal(policy.extractDraft(input({autocomplete: 'section-blue webauthn'})), null);
  assert.equal(policy.extractDraft(input({name: 'account_passcode'})), null);
  assert.equal(policy.extractDraft(input({id: 'cvv'})), null);
  assert.equal(policy.extractDraft(input({ariaLabel: 'Social Security Number'})), null);
  assert.equal(policy.extractDraft(input({placeholder: 'Bank routing number'})), null);
  assert.equal(policy.extractDraft(input({name: 'wallet_seed_phrase'})), null);
  assert.equal(policy.extractDraft(input({id: 'recovery-code'})), null);
  assert.equal(policy.extractDraft(input({title: 'Authenticator code'})), null);
});

test('rejects sensitive wording supplied only by associated labels', () => {
  assert.equal(
    policy.extractDraft(
      input({labels: [{textContent: 'Account password'}]}),
    ),
    null,
  );

  assert.equal(
    policy.extractDraft(
      input({
        closest(selector) {
          return selector === 'label'
            ? {textContent: 'One-time code'}
            : null;
        },
      }),
    ),
    null,
  );

  const ownerDocument = {
    getElementById(id) {
      return id === 'recovery-label'
        ? {textContent: 'Recovery code'}
        : null;
    },
  };
  assert.equal(
    policy.extractDraft(
      input({
        attributes: {'aria-labelledby': 'recovery-label'},
        ownerDocument,
      }),
    ),
    null,
  );
});

test('normalizes invisible, full-width, and separator-obfuscated sensitive labels', () => {
  assert.equal(policy.extractDraft(input({name: 'pa\u200bssword'})), null);
  assert.equal(
    policy.extractDraft(input({placeholder: 'ｒｅｃｏｖｅｒｙ　ｃｏｄｅ'})),
    null,
  );
  assert.equal(policy.extractDraft(input({ariaLabel: 's.e.e.d p.h.r.a.s.e'})), null);
  assert.equal(
    policy.extractDraft(input({autocomplete: 'one-\u200btime-code'})),
    null,
  );
});

test('honors field and ancestor exclusion markers', () => {
  assert.equal(
    policy.extractDraft(input({dataset: {cliptownIgnore: ''}})),
    null,
  );
  assert.equal(policy.extractDraft(input({dataset: {private: 'true'}})), null);
  assert.equal(
    policy.extractDraft(
      input({
        tagName: 'DIV',
        isContentEditable: true,
        getAttribute(name) {
          return name === 'data-cliptown-ignore' ? '' : null;
        },
      }),
    ),
    null,
  );
  assert.equal(
    policy.extractDraft(
      input({
        closest(selector) {
          return selector === '[data-cliptown-ignore],[data-private]'
            ? {dataset: {private: ''}}
            : null;
        },
      }),
    ),
    null,
  );
});

test('rejects disabled, read-only, unsupported, and tiny fields', () => {
  assert.equal(policy.extractDraft(input({disabled: true})), null);
  assert.equal(policy.extractDraft(input({readOnly: true})), null);
  assert.equal(policy.extractDraft(input({type: 'email'})), null);
  assert.equal(policy.extractDraft(input({value: 'x'})), null);
});

test('bounds staged plaintext before session handoff', () => {
  const draft = policy.extractDraft(
    input({value: 'a'.repeat(policy.MAX_DRAFT_CHARS + 50)}),
  );
  assert.equal(draft.length, policy.MAX_DRAFT_CHARS);
});
