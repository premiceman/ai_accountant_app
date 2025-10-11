// NOTE: Hotfix — TS types for shared flags + FE v1 flip + staged loader + prefer-v1 legacy; aligns with Phase-1/2/3 specs. Additive, non-breaking.
(function () {
  const STRINGS = Object.freeze({
    loading: 'Updating analytics',
    finalising: 'Finalising',
    failed: 'failed',
  });

  function ensureElements(element) {
    if (!element) return { message: null, reason: null };
    const message = element.querySelector('[data-loading-message]');
    let reason = element.querySelector('[data-loading-reason]');
    if (!reason) {
      reason = document.createElement('div');
      reason.dataset.loadingReason = 'true';
      reason.className = 'mt-1 small text-light';
      const content = element.querySelector('.dashboard-loading-overlay__content') || element;
      content.appendChild(reason);
    }
    return { message, reason };
  }

  function show(element) {
    if (!element) return;
    element.classList.remove('d-none');
  }

  function hide(element) {
    if (!element) return;
    element.classList.add('d-none');
  }

  function setMessage(element, elRefs, text) {
    if (!element || !elRefs.message) return;
    elRefs.message.textContent = text;
  }

  function setReason(elRefs, reason) {
    if (!elRefs.reason) return;
    elRefs.reason.textContent = reason || '';
    elRefs.reason.classList.toggle('d-none', !reason);
  }

  async function track(element, options, runner) {
    if (typeof runner !== 'function') return undefined;
    const enabled = Boolean(options?.enabled);
    const refs = ensureElements(element);
    if (enabled) {
      setMessage(element, refs, STRINGS.loading);
      setReason(refs, '');
      show(element);
      element.dataset.stagedLoader = 'active';
    } else if (element) {
      setReason(refs, '');
      show(element);
      element.dataset.stagedLoader = 'spinner';
    }
    try {
      const stage = {
        finalising() {
          if (enabled) setMessage(element, refs, STRINGS.finalising);
        }
      };
      const result = await runner(stage);
      const pending = element?.dataset?.pendingProcessing;
      if (pending && element) {
        let nextState = null;
        try {
          nextState = JSON.parse(pending);
        } catch (error) {
          nextState = null;
        }
        delete element.dataset.pendingProcessing;
        delete element.dataset.stagedLoader;
        const section = document.getElementById('accounting-section');
        if (section && nextState) {
          section.classList.toggle('is-loading', Boolean(nextState.active));
        }
        if (nextState && nextState.active) {
          setMessage(element, refs, nextState.message || STRINGS.loading);
          setReason(refs, '');
          show(element);
        } else {
          setReason(refs, '');
          hide(element);
        }
      } else {
        if (element) {
          setReason(refs, '');
          hide(element);
          delete element.dataset.stagedLoader;
        }
      }
      return result;
    } catch (error) {
      if (enabled) {
        setMessage(element, refs, STRINGS.failed);
        setReason(refs, error?.reason || error?.message || 'Unexpected error');
        if (element) delete element.dataset.pendingProcessing;
        element.dataset.stagedLoader = 'error';
      } else if (element && refs.message) {
        refs.message.textContent = 'Failed';
      }
      throw error;
    }
  }

  window.StagedLoader = {
    track,
    hide,
  };
})();
