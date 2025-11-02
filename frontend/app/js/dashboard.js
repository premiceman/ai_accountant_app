(function () {
  function updateGreeting(me) {
    const message = document.getElementById('dashboard-message');
    if (!message) return;
    const first = me?.profile?.firstName || '';
    if (first) {
      message.textContent = `Hi ${first}, we’ll populate this space with the new experience soon.`;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    App.bootstrap('dashboard')
      .then((me) => {
        if (me) {
          updateGreeting(me);
        }
      })
      .catch((error) => {
        console.error('Dashboard initialisation failed', error);
        const message = document.getElementById('dashboard-message');
        if (message) {
          message.textContent = 'We could not load your account details. Please refresh the page to try again.';
        }
      });
  });
})();
