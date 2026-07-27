(() => {
  if (globalThis.__cliptownDraftRecoveryLoaded) return;
  globalThis.__cliptownDraftRecoveryLoaded = true;

  const policy = globalThis.ClipTownCapturePolicy;
  if (!policy) throw new Error('ClipTown capture policy was not loaded');

  const timers = new WeakMap();
  const DEBOUNCE_MS = 1500;

  function stage(element, reason) {
    const text = policy.extractDraft(element);
    if (!text) return;
    chrome.runtime.sendMessage({
      action: 'stage_draft',
      reason,
      text,
      fieldKind: element.isContentEditable ? 'contenteditable' : String(element.tagName).toLowerCase(),
    }).catch(() => undefined);
  }

  document.addEventListener('input', (event) => {
    const element = event.target;
    if (!policy.isEditable(element) || policy.isProtected(element)) return;
    const previous = timers.get(element);
    if (previous) clearTimeout(previous);
    timers.set(element, setTimeout(() => stage(element, 'idle'), DEBOUNCE_MS));
  }, true);

  document.addEventListener('blur', (event) => {
    const element = event.target;
    if (!policy.isEditable(element) || policy.isProtected(element)) return;
    const previous = timers.get(element);
    if (previous) clearTimeout(previous);
    stage(element, 'blur');
  }, true);
})();
