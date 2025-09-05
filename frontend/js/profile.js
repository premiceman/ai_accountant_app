// frontend/js/profile.js
(async function init() {
  try {
    const { me } = await Auth.requireAuth();
    Auth.setBannerTitle('Profile');

    // Fill profile form
    fillProfile(me);

    // License
    const tier = (me.licenseTier || 'free').toLowerCase();
    document.getElementById('license-tier').textContent = tier.charAt(0).toUpperCase() + tier.slice(1);
    document.getElementById('license-tier').className = 'badge ' + (tier === 'premium' ? 'bg-success' : tier === 'basic' ? 'bg-info' : 'bg-primary');
    document.getElementById('license-caption').textContent =
      tier === 'premium' ? 'You are on Premium — thanks for supporting us!'
      : tier === 'basic' ? 'You are on Basic.'
      : 'You’re on our Free plan. Upgrade options are coming soon.';

    // EULA
    const eulaAcceptedAt = me.eulaAcceptedAt ? new Date(me.eulaAcceptedAt) : null;
    document.getElementById('eula-status').textContent = eulaAcceptedAt ? 'Accepted' : 'Unknown';
    document.getElementById('eula-status').className = 'badge ' + (eulaAcceptedAt ? 'bg-success' : 'bg-secondary');
    document.getElementById('eula-accepted-at').textContent = eulaAcceptedAt ? eulaAcceptedAt.toLocaleString() : '—';
    document.getElementById('eula-version').textContent = me.eulaVersion || '—';

    // Events
    document.getElementById('profile-form').addEventListener('submit', onProfileSave);
    document.getElementById('profile-reset').addEventListener('click', () => fillProfile(window.__ME__));
    document.getElementById('password-form').addEventListener('submit', onChangePassword);
    document.getElementById('password-reset').addEventListener('click', () => resetPasswordForm());
  } catch (e) {
    console.error(e);
  }
})();

function fillProfile(me) {
  document.getElementById('firstName').value = me.firstName || '';
  document.getElementById('lastName').value  = me.lastName || '';
  document.getElementById('username').value  = me.username || '';
  document.getElementById('email').value     = me.email || '';
}

async function onProfileSave(ev) {
  ev.preventDefault();
  clearAlert('profile-alert');

  const body = {
    firstName: document.getElementById('firstName').value.trim(),
    lastName:  document.getElementById('lastName').value.trim(),
    username:  document.getElementById('username').value.trim(),
    email:     document.getElementById('email').value.trim()
  };

  if (!body.firstName || !body.lastName || !body.email) {
    showAlert('profile-alert', 'Please fill required fields (first name, last name, email).', 'warning');
    return;
  }

  try {
    const res = await Auth.fetch('/api/user/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const j = await res.json().catch(()=>({}));
      showAlert('profile-alert', j.error || 'Failed to save profile.', 'danger');
      return;
    }
    const me = await res.json();
    window.__ME__ = me;
    showAlert('profile-alert', 'Profile updated.', 'success');
  } catch {
    showAlert('profile-alert', 'Network error while saving.', 'danger');
  }
}

function resetPasswordForm() {
  document.getElementById('currentPassword').value = '';
  document.getElementById('newPassword').value = '';
  document.getElementById('confirmPassword').value = '';
  clearAlert('pwd-alert');
}

async function onChangePassword(ev) {
  ev.preventDefault();
  clearAlert('pwd-alert');

  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword     = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  if (!currentPassword || !newPassword || !confirmPassword) {
    showAlert('pwd-alert', 'Please enter all password fields.', 'warning');
    return;
  }
  if (newPassword.length < 8) {
    showAlert('pwd-alert', 'New password must be at least 8 characters.', 'warning');
    return;
  }
  if (newPassword !== confirmPassword) {
    showAlert('pwd-alert', 'New password and confirmation do not match.', 'warning');
    return;
  }

  try {
    const res = await Auth.fetch('/api/user/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
    });
    const j = await res.json().catch(()=> ({}));
    if (!res.ok) {
      showAlert('pwd-alert', j.error || 'Failed to change password.', 'danger');
      return;
    }
    resetPasswordForm();
    showAlert('pwd-alert', 'Password updated successfully.', 'success');
  } catch {
    showAlert('pwd-alert', 'Network error while updating password.', 'danger');
  }
}

// UI helpers
function showAlert(containerId, message, type='info') {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div class="alert alert-${type} alert-dismissible fade show" role="alert">
    ${escapeHtml(message)}
    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
  </div>`;
}
function clearAlert(containerId){ const el=document.getElementById(containerId); if(el) el.innerHTML=''; }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

