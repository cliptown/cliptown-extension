(function attachPolicy(root, factory) {
  const policy = factory();
  root.ClipTownCapturePolicy = policy;
  if (typeof module === 'object' && module.exports) module.exports = policy;
})(globalThis, function createPolicy() {
  const MAX_DRAFT_CHARS = 100000;
  const MAX_LABEL_CHARS = 300;
  const MAX_DESCRIPTION_REFERENCES = 32;
  const PROTECTED_AUTOCOMPLETE = /(?:^|\s)(?:cc-|current-password|new-password|one-time-code|webauthn)/i;
  const PROTECTED_COMPACT_LABEL = /(?:password|passcode|otp|onetimecode|creditcard|cardnumber|securitycode|cvv|cvc|socialsecurity|ssn|taxid|routingnumber|bankaccount|privatekey|secretkey|apikey|seedphrase|recoverycode|authenticatorcode)/;
  const INVISIBLE_OR_CONTROL = /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufeff\uffa0]/g;
  const ALLOWED_INPUT_TYPES = new Set(['text', 'search', 'url']);
  const IGNORE_SELECTOR = '[data-cliptown-ignore],[data-private]';

  function attribute(element, name) {
    if (typeof element?.getAttribute !== 'function') return null;
    try {
      return element.getAttribute(name);
    } catch {
      return null;
    }
  }

  function ancestor(element, selector) {
    if (typeof element?.closest !== 'function') return null;
    try {
      return element.closest(selector);
    } catch {
      return null;
    }
  }

  function normalizeSensitiveText(value) {
    return String(value ?? '')
      .slice(0, MAX_LABEL_CHARS)
      .normalize('NFKC')
      .replace(INVISIBLE_OR_CONTROL, '')
      .toLowerCase();
  }

  function isExcludedByMarker(element) {
    return element?.dataset?.cliptownIgnore != null ||
      element?.dataset?.private != null ||
      attribute(element, 'data-cliptown-ignore') != null ||
      attribute(element, 'data-private') != null ||
      ancestor(element, IGNORE_SELECTOR) != null;
  }

  function labelReferences(element) {
    return String(attribute(element, 'aria-labelledby') || '')
      .slice(0, 4096)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  function hasExcessiveDescriptionFanout(element) {
    const labels = element?.labels;
    const labelCount = labels && typeof labels.length === 'number' ? labels.length : 0;
    return labelCount > MAX_DESCRIPTION_REFERENCES ||
      labelReferences(element).length > MAX_DESCRIPTION_REFERENCES;
  }

  function describingText(element) {
    const parts = [
      element?.name,
      element?.id,
      element?.ariaLabel ?? attribute(element, 'aria-label'),
      element?.placeholder ?? attribute(element, 'placeholder'),
      element?.title ?? attribute(element, 'title'),
    ];

    const labels = element?.labels;
    if (labels && typeof labels.length === 'number') {
      const count = Math.min(labels.length, MAX_DESCRIPTION_REFERENCES);
      for (let index = 0; index < count; index += 1) {
        parts.push(labels[index]?.textContent, labels[index]?.innerText);
      }
    }

    const parentLabel = ancestor(element, 'label');
    parts.push(parentLabel?.textContent, parentLabel?.innerText);

    const document = element?.ownerDocument;
    if (typeof document?.getElementById === 'function') {
      for (const id of labelReferences(element).slice(0, MAX_DESCRIPTION_REFERENCES)) {
        const label = document.getElementById(id);
        parts.push(label?.textContent, label?.innerText);
      }
    }

    return parts.map(normalizeSensitiveText).join(' ');
  }

  function isEditable(element) {
    if (!element || element.disabled || element.readOnly) return false;
    if (element.isContentEditable) return true;
    if (element.tagName === 'TEXTAREA') return true;
    if (element.tagName !== 'INPUT') return false;
    return ALLOWED_INPUT_TYPES.has(String(element.type || 'text').toLowerCase());
  }

  function isProtected(element) {
    const type = String(element?.type || '').toLowerCase();
    const autocomplete = normalizeSensitiveText(
      element?.autocomplete ?? attribute(element, 'autocomplete'),
    );
    const compactLabel = describingText(element).replace(/[^a-z0-9]+/g, '');

    return isExcludedByMarker(element) ||
      hasExcessiveDescriptionFanout(element) ||
      type === 'password' ||
      PROTECTED_AUTOCOMPLETE.test(autocomplete) ||
      PROTECTED_COMPACT_LABEL.test(compactLabel);
  }

  function extractDraft(element) {
    if (!isEditable(element) || isProtected(element)) return null;
    const raw = element.isContentEditable ? element.innerText : element.value;
    const text = String(raw || '').trim();
    if (text.length < 3) return null;
    return text.slice(0, MAX_DRAFT_CHARS);
  }

  return {MAX_DRAFT_CHARS, isEditable, isProtected, extractDraft};
});
