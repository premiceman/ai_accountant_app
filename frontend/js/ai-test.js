// frontend/js/ai-test.js
(function () {
    const form = document.getElementById('ai-form');
    const input = document.getElementById('ai-input');
    const btn = document.getElementById('ai-send');
    const btnText = document.getElementById('ai-send-text');
    const spinner = document.getElementById('ai-spinner');
    const output = document.getElementById('ai-output');
  
    const API_BASE = '/api';
    const getToken = () =>
      localStorage.getItem('token') ||
      localStorage.getItem('jwt') ||
      localStorage.getItem('authToken') ||
      sessionStorage.getItem('token');
  
    function toLogin() {
      location.href = './login.html?next=' + encodeURIComponent('./home.html');
    }
  
    function setLoading(is) {
      btn.disabled = is;
      spinner.classList.toggle('d-none', !is);
      btnText.textContent = is ? 'Thinking…' : 'Ask';
    }
  
    async function ask(prompt) {
      const token = getToken();
      if (!token) return toLogin();
      const res = await fetch(`${API_BASE}/ai/ask`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt }),
      });
      if (res.status === 401) return toLogin();
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`AI error ${res.status}: ${t}`);
      }
      return res.json();
    }
  
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const prompt = (input.value || '').trim();
      if (!prompt) return;
      setLoading(true);
      output.textContent = '…';
      try {
        const { answer, model } = await ask(prompt);
        output.textContent = answer || '(no answer)';
        // Optional: show model name somewhere
        // console.log('model:', model);
      } catch (err) {
        console.error(err);
        output.textContent = 'Failed to get an answer. Check backend logs.';
      } finally {
        setLoading(false);
      }
    });
  })();
  