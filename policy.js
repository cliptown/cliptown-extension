(function attachPolicy(root, factory) {
  const policy = factory();
  root.ClipTownCapturePolicy = policy;
  if (typeof module === 'object' && module.exports) module.exports = policy;
})(globalThis, function createPolicy() {
  const MAX_DRAFT_CHARS = 100000;
  const PROTECTED_AUTOCOMPLETE = /(?:^|\s)(?:cc-|current-password|new-password|one-time-code|webauthn)/i;
  const PROTECTED_COMPACT_LABEL = /(?:password|passcode|otp|onetimecode|creditcard|cardnumber|securitycode|cvv|cvc|socialsecurity|ssn|taxid|routingnumber|bankaccount|privatekey|secretkey|apikey|seedphrase|recoverycode|authenticatorcode)/;
  const INVISIBLE_OR_CONTROL = /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufeff\uffa0]/g;
  const ALLOWED_INPUT_TYPES = new Set(['text', 'search', 'url']);

  function normalizeSensitiveText(value) {
    return String(value || '')
      .normalize('NFKC')
      .replace(INVISIBLE_OR_CONTROL, '')
      .toLowerCase();
  }

  function associatedLabelText(element) {
    const values = [];
    for (const label of Array.from(element?.labels || [])) {
      values.push(label?.textContent, label?.innerText);
    }

    const parentLabel = element?.closest?.('label');
    if (parentLabel && parentLabel !== element) {
      values.push(parentLabel.textContent, parentLabel.innerText);
    }

    const labelledBy = String(element?.getAttribute?.('aria-labelledby') || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const document = element?.ownerDocument;
    for (const id of labelledBy) {
      const label = document?.getElementById?.(id);
      values.push(label?.textContent, label?.innerText);
    }

    return values.filter((value) => value != null).join(' ');
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
    const autocomplete = normalizeSensitiveText(element?.autocomplete);
    const label = [
      element?.name,
      element?.id,
      element?.ariaLabel,
      element?.getAttribute?.('aria-label'),
      element?.placeholder,
      element?.title,
      associatedLabelText(element),
    ]
      .map(normalizeSensitiveText)
      .join(' ');
    const compactLabel = label.replace(/[^a-z0-9]+/g, '');
    const explicitlyIgnored =
      element?.dataset?.cliptownIgnore != null ||
      element?.dataset?.private != null ||
      element?.getAttribute?.('data-cliptown-ignore') != null ||
      element?.getAttribute?.('data-private') != null ||
      element?.closest?.('[data-cliptown-ignore],[data-private]') != null;

    return (
      explicitlyIgnored ||
      type === 'password' ||
      PROTECTED_AUTOCOMPLETE.test(autocomplete) ||
      PROTECTED_COMPACT_LABEL.test(compactLabel)
    );
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
