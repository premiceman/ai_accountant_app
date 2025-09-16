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
  
    let messages = [];     // in-memory only
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
  
    // Renders a loading skeleton (for assistant while waiting)
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
  
    function setBusy(v) {
      btnSend.disabled = !!v;
      btnStop.disabled = !v;
      chatText.disabled = !!v;
    }
  
    function resetChat() {
      messages = [];
      chatBody.innerHTML = '';
      chatText.value = '';
      chatText.focus();
    }
  
    // Handle example clicks
    $$('.example-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        chatText.value = btn.getAttribute('data-example') || '';
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
  
    btnNew.addEventListener('click', resetChat);
  
    btnStop.addEventListener('click', () => {
      try { aborter?.abort(); } catch {}
    });
  
    chatForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const text = (chatText.value || '').trim();
      if (!text) return;
  
      // push user msg in UI + memory
      addMessage('user', text);
      messages.push({ role: 'user', content: text });
      chatText.value = '';
  
      // assistant placeholder bubble (we'll stream into this)
      const aMsg = addMessage('assistant', '');
      const aBubble = aMsg; // already bubble
  
      // stream from /api/ai/chat
      setBusy(true);
      aborter = new AbortController();
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
          setBusy(false);
          return;
        }
  
        const reader = resp.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buf = '';
  
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
  
          // split SSE chunks on double newline
          const parts = buf.split('\n\n');
          buf = parts.pop(); // keep last partial
          for (const chunk of parts) {
            const line = chunk.trim();
            if (!line.startsWith('data:')) continue;
            const jsonStr = line.slice(5).trim();
            if (!jsonStr) continue;
  
            // handle events
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
                // finalise assistant message into memory
                messages.push({ role: 'assistant', content: aBubble.textContent });
              }
            } catch {
              // ignore parse noise
            }
          }
          scrollToBottom();
        }
  
        if (!hadChunk) {
          // Non-stream fallback (if server returned one-shot)
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
        setBusy(false);
        aborter = null;
      }
    });
  
    // Init
    document.addEventListener('DOMContentLoaded', async () => {
      try {
        await Auth.requireAuth();
        Auth.setBannerTitle('Scenario Lab');
        chatText.focus();
      } catch (e) {
        console.error(e);
      }
    });
  })();
  