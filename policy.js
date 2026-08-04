(function attachPolicy(root, factory) {
  const policy = factory();
  root.ClipTownCapturePolicy = policy;
  if (typeof module === 'object' && module.exports) module.exports = policy;
})(globalThis, function createPolicy() {
  const MAX_DRAFT_CHARS = 100000;
  const PROTECTED_AUTOCOMPLETE = /(?:^|\s)(?:cc-|current-password|new-password|one-time-code|webauthn)/i;
  const PROTECTED_LABEL = /(?:password|passcode|otp|one.?time|credit.?card|card.?number|cvv|cvc|social.?security|ssn|tax.?id|routing.?number|bank.?account|private.?key|seed.?phrase|recovery.?code)/i;
  const ALLOWED_INPUT_TYPES = new Set(['text', 'search', 'url']);
  const IGNORE_ATTRIBUTES = ['data-cliptown-ignore', 'data-private'];
  const MAX_LABEL_CHARS = 300;

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

  function isExcludedByMarker(element) {
    if (element?.dataset?.cliptownIgnore != null || element?.dataset?.private != null) return true;
    return IGNORE_ATTRIBUTES.some(
      (name) => attribute(element, name) != null || ancestor(element, `[${name}]`) != null,
    );
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
      for (let index = 0; index < labels.length; index += 1) parts.push(labels[index]?.textContent);
    }
    parts.push(ancestor(element, 'label')?.textContent);

    const describedBy = String(attribute(element, 'aria-labelledby') || '');
    const document = element?.ownerDocument;
    if (describedBy && typeof document?.getElementById === 'function') {
      for (const id of describedBy.split(/\s+/).filter(Boolean)) {
        parts.push(document.getElementById(id)?.textContent);
      }
    }

    return parts.map((value) => String(value ?? '').slice(0, MAX_LABEL_CHARS)).join(' ');
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
    const autocomplete = String(element?.autocomplete ?? attribute(element, 'autocomplete') ?? '');
    return isExcludedByMarker(element) ||
      type === 'password' ||
      PROTECTED_AUTOCOMPLETE.test(autocomplete) ||
      PROTECTED_LABEL.test(describingText(element));
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
