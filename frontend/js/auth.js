// frontend/js/auth.js
(function () {
  const KEYS = ['token','jwt','authToken'];
  const getToken = () => { for (const k of KEYS){ const v=localStorage.getItem(k)||sessionStorage.getItem(k); if(v) return v; } return null; };
  const decodeJWT = (t) => { try { const b64=t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'); const json=decodeURIComponent(atob(b64).split('').map(c=>'%'+('00'+c.charCodeAt(0).toString(16)).slice(-2)).join('')); return JSON.parse(json);} catch { return {}; } };
  const isExpired = (t) => { const p=decodeJWT(t); if(!p||!p.exp) return false; return Math.floor(Date.now()/1000)>=p.exp; };
  const redirectTo = (p)=>{ location.href=p; };
  const redirectToLogin = ()=>{ const next=encodeURIComponent(location.pathname+location.search); redirectTo(`./login.html?next=${next}`); };
  const redirectToHome  = ()=>redirectTo('./home.html');
  const signOut = ()=>{ KEYS.forEach(k=>localStorage.removeItem(k)); KEYS.forEach(k=>sessionStorage.removeItem(k)); redirectToLogin(); };
  const hardRedirectIfNotAuthed = ()=>{ const t=getToken(); if(!t||isExpired(t)) redirectToLogin(); };
  const requireAuth = async ()=>{ const t=getToken(); if(!t||isExpired(t)){ signOut(); throw new Error('Not authenticated'); } const res=await fetch('/api/user/me',{ headers:{ Authorization:`Bearer ${t}` }, cache:'no-store'}); if(res.status===401){ signOut(); throw new Error('Unauthorized'); } if(!res.ok) throw new Error('Auth check failed'); const me=await res.json(); window.__ME__=me; return { token:t, me }; };
  const authFetch = (url,options={})=>{ const t=getToken(); if(!t){ signOut(); return Promise.reject(new Error('No token')); } const headers=Object.assign({},options.headers||{}, { Authorization:`Bearer ${t}` }); return fetch(url,Object.assign({},options,{headers})).then(r=>{ if(r.status===401) signOut(); return r; }); };
  const setBannerTitle = (suffix)=>{ const name=(window.__ME__?.firstName||'').trim(); const title=name?`${name} — ${suffix}`:suffix; document.title=title; const h=document.querySelector('h1.page-title, h1'); if(h && !h.dataset.lockTitle) h.textContent=title; const g=document.getElementById('greeting-name'); if(g && name) g.textContent=name; };
  const enforce = (opts={})=>{ const path=(location.pathname.split('/').pop()||'index.html').toLowerCase(); const allow=new Set((opts.allowAnonymous||['login.html','signup.html','index.html']).map(s=>s.toLowerCase())); const t=getToken(); const authed=!!t && !isExpired(t); if(!allow.has(path)){ hardRedirectIfNotAuthed(); } else if(opts.bounceIfAuthed && authed){ redirectToHome(); } };
  window.Auth = { getToken, decodeJWT, isExpired, signOut, hardRedirectIfNotAuthed, requireAuth, fetch: authFetch, setBannerTitle, enforce };
})();
