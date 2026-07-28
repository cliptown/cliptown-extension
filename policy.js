(function attachPolicy(root, factory) {
  const policy = factory();
  root.ClipTownCapturePolicy = policy;
  if (typeof module === 'object' && module.exports) module.exports = policy;
})(globalThis, function createPolicy() {
  const MAX_DRAFT_CHARS = 100000;
  const PROTECTED_AUTOCOMPLETE = /(?:^|\s)(?:cc-|current-password|new-password|one-time-code|webauthn)/i;
  const PROTECTED_LABEL = /(?:password|passcode|otp|one.?time|credit.?card|card.?number|cvv|cvc|social.?security|ssn|tax.?id|routing.?number|bank.?account|private.?key|seed.?phrase|recovery.?code)/i;
  const ALLOWED_INPUT_TYPES = new Set(['text', 'search', 'url']);

  function isEditable(element) {
    if (!element || element.disabled || element.readOnly) return false;
    if (element.isContentEditable) return true;
    if (element.tagName === 'TEXTAREA') return true;
    if (element.tagName !== 'INPUT') return false;
    return ALLOWED_INPUT_TYPES.has(String(element.type || 'text').toLowerCase());
  }

  function isProtected(element) {
    const type = String(element?.type || '').toLowerCase();
    const autocomplete = String(element?.autocomplete || '');
    const label = [
      element?.name,
      element?.id,
      element?.ariaLabel,
      element?.placeholder,
    ].map((value) => String(value || '')).join(' ');
    const explicitlyIgnored = element?.dataset?.cliptownIgnore != null ||
      element?.dataset?.private != null ||
      element?.getAttribute?.('data-cliptown-ignore') != null ||
      element?.getAttribute?.('data-private') != null;
    return explicitlyIgnored ||
      type === 'password' ||
      PROTECTED_AUTOCOMPLETE.test(autocomplete) ||
      PROTECTED_LABEL.test(label);
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
