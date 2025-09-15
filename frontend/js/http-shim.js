// /frontend/js/http-shim.js
(function(){
    const _fetch = window.fetch;
    window.fetch = function(input, init = {}) {
      try {
        const url = typeof input === 'string' ? input : input.url;
        if (url && /(^\/api\/)|(\:\/\/[^\/]+\/api\/)/.test(url)) {
          if (!init || typeof init !== 'object') init = {};
          if (!('credentials' in init)) init.credentials = 'include';
        }
      } catch {}
      return _fetch(input, init);
    };
  })();
  