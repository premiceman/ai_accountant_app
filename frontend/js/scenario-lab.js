// frontend/js/scenario-lab.js
(function () {
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  
    const chatBody = $('#chat-body');
    const chatForm = $('#chat-form');
    const chatText = $('#chat-text');
    const btnSend  = $('#btn-send');
    const btnStop  = $('#btn-stop');
    const btnNew   = $('#btn-new');
  
    const composer = chatForm; // semantic alias
  
    let messages = [];     // in-memory only (no persistence)
    let aborter  = null;   // AbortController for a streaming request
  
    function scrollToBottom() {
      chatBody.scrollTop = chatBody.scrollHeight;
    }
  
    function addMessage(role, content) {
      const wrap = document.createElement('div');
      wrap.className = `msg ${role}`;
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = content || '';
      wrap.appendChild(bubble);
      chatBody.appendChild(wrap);
      scrollToBottom();
      return bubble;
    }
  
    function addSkeleton() {
      const wrap = document.createElement('div');
      wrap.className = 'msg assistant';
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      for (let i = 0; i < 3; i++) {
        const sk = document.createElement('div');
        sk.className = 'skeleton';
        sk.style.width = (70 + Math.random() * 25) + '%';
        bubble.appendChild(sk);
      }
      wrap.appendChild(bubble);
      chatBody.appendChild(wrap);
      scrollToBottom();
      return { wrap, bubble };
    }
  
    // Auto-expand textarea (ChatGPT-like)
    function autosize() {
      chatText.style.height = 'auto';
      const max = 180; // px (matches CSS max-height)
      const next = Math.min(chatText.scrollHeight, max);
      chatText.style.height = next + 'px';
    }
  
    // UI state helpers (purely aesthetic)
    function setComposerEmpty(isEmpty) {
      composer.classList.toggle('composer--empty', !!isEmpty);
      composer.classList.toggle('composer--ready', !isEmpty);
      btnSend.disabled = !!isEmpty;
    }
  
    function setStreaming(on) {
      composer.classList.toggle('composer--streaming', !!on);
      btnStop.disabled = !on;
      // keep send disabled while streaming; textarea read-only feel
      btnSend.disabled = true;
      chatText.disabled = !!on;
    }
  
    function resetChat() {
      messages = [];
      chatBody.innerHTML = '';
      chatText.value = '';
      autosize();
      setComposerEmpty(true);
      setStreaming(false);
      chatText.focus();
    }
  
    // Example buttons paste text (no backend change)
    $$('.example-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        chatText.value = btn.getAttribute('data-example') || '';
        autosize();
        setComposerEmpty(!chatText.value.trim());
        chatText.focus();
      });
    });
  
    // Shift+Enter = newline, Enter = submit
    chatText.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        chatForm.requestSubmit();
      }
    });
  
    // Input dynamics: mint arrow when has text; grey otherwise; auto-expand
    chatText.addEventListener('input', () => {
      autosize();
      setComposerEmpty(!chatText.value.trim());
    });
  
    btnNew.addEventListener('click', resetChat);
  
    btnStop.addEventListener('click', () => {
      try { aborter?.abort(); } catch {}
    });
  
    chatForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const text = (chatText.value || '').trim();
      if (!text) return;
  
      // Push user msg
      addMessage('user', text);
      messages.push({ role: 'user', content: text });
      chatText.value = '';
      autosize();
      setComposerEmpty(true);
  
      // Assistant placeholder we stream into
      const aMsg = addMessage('assistant', '');
      const aBubble = aMsg;
  
      // Stream from /api/ai/chat (unchanged)
      aborter = new AbortController();
      setStreaming(true);
      let hadChunk = false;
  
      try {
        const resp = await Auth.fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages }),
          signal: aborter.signal
        });
  
        if (!resp.ok || !resp.body) {
          const t = await resp.text().catch(() => '');
          aBubble.textContent = t || 'Sorry — something went wrong.';
          setStreaming(false);
          return;
        }
  
        const reader = resp.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buf = '';
  
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
  
          const parts = buf.split('\n\n');
          buf = parts.pop();
          for (const chunk of parts) {
            const line = chunk.trim();
            if (!line.startsWith('data:')) continue;
            const jsonStr = line.slice(5).trim();
            if (!jsonStr) continue;
            if (jsonStr === '[DONE]') continue;
            try {
              const ev = JSON.parse(jsonStr);
              if (ev.error) {
                aBubble.textContent = ev.error || 'Error.';
                continue;
              }
              if (ev.delta) {
                aBubble.textContent += ev.delta;
                hadChunk = true;
              }
              if (ev.done) {
                messages.push({ role: 'assistant', content: aBubble.textContent });
              }
            } catch {}
          }
          scrollToBottom();
        }
  
        if (!hadChunk) {
          messages.push({ role: 'assistant', content: aBubble.textContent || 'Done.' });
        }
      } catch (e) {
        if (e?.name === 'AbortError') {
          aBubble.textContent += '\n\n[stopped]';
        } else {
          console.error(e);
          aBubble.textContent = 'Network error.';
        }
      } finally {
        setStreaming(false);
        aborter = null;
      }
    });
  
    // Init
    document.addEventListener('DOMContentLoaded', async () => {
      try {
        await Auth.requireAuth();
        Auth.setBannerTitle('Scenario Lab');
        autosize();
        setComposerEmpty(true);
        chatText.focus();
      } catch (e) {
        console.error(e);
      }
    });
  })();
  