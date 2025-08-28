// frontend/js/profile.js
(function(){
  const $ = (id)=>document.getElementById(id);
  const msg = $('p-msg');
  function setMsg(t){ if (msg){ msg.textContent = t || ''; } }
  async function init(){
    try {
      const { me } = await Auth.requireAuth();
      Auth.setBannerTitle('Profile');
      $('firstName').value = me.firstName || '';
      $('lastName').value  = me.lastName  || '';
      $('email').value     = me.email     || '';
      $('phone').value     = me.phone     || '';
      $('address').value   = me.address   || '';
    } catch (e) { /* redirected */ }
  }
  async function save(e){
    e.preventDefault();
    setMsg('Saving...');
    const body = JSON.stringify({
      firstName: $('firstName').value.trim(),
      lastName:  $('lastName').value.trim(),
      email:     $('email').value.trim(),
      phone:     $('phone').value.trim(),
      address:   $('address').value.trim()
    });
    const res = await Auth.fetch('/api/user/me', { method:'PUT', headers:{'Content-Type':'application/json'}, body });
    if (!res.ok){
      const t = await res.text();
      setMsg('Save failed: ' + t);
      return;
    }
    setMsg('Saved.');
  }
  document.getElementById('profile-form').addEventListener('submit', save);
  init();
})();
