(function () {
  function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value || '—';
  }

  function formatInterests(interests) {
    if (!Array.isArray(interests) || !interests.length) {
      return '—';
    }
    return interests.join(', ');
  }

  document.addEventListener('DOMContentLoaded', () => {
    App.bootstrap('profile')
      .then((me) => {
        if (!me?.profile) return;
        const profile = me.profile;
        const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
        setText('profile-name', fullName || profile.email || '—');
        setText('profile-email', profile.email || '—');
        setText('profile-country', profile.country ? profile.country.toUpperCase() : '—');
        setText('profile-tier', (profile.licenseTier || 'free').replace(/\b\w/g, (c) => c.toUpperCase()));
        setText('profile-interests', formatInterests(profile.profileInterests));
      })
      .catch((error) => {
        console.error('Failed to load profile', error);
        setText('profile-name', '—');
        setText('profile-email', '—');
        setText('profile-country', '—');
        setText('profile-tier', '—');
        setText('profile-interests', '—');
      });
  });
})();
