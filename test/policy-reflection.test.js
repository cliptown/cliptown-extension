const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../policy.js');

test('raw protected autocomplete remains authoritative when Chromium reflects an empty property', () => {
  const attributes = new Map([
    ['autocomplete', 'one-\u200btime-code'],
  ]);
  const element = {
    tagName: 'INPUT',
    type: 'text',
    value: 'otp secret that must not stage',
    autocomplete: '',
    name: 'ordinary-field',
    id: 'ordinary-id',
    ariaLabel: '',
    placeholder: '',
    title: '',
    labels: [],
    dataset: {},
    disabled: false,
    readOnly: false,
    isContentEditable: false,
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    closest() {
      return null;
    },
  };

  assert.equal(policy.extractDraft(element), null);
});
