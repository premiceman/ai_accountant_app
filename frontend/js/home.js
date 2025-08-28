// frontend/js/home.js
(async function(){
  try {
    const { me } = await Auth.requireAuth();
    Auth.setBannerTitle('Dashboard');
    const g = document.getElementById('greeting-name');
    if (g && me?.firstName) g.textContent = me.firstName;
  } catch (e) { /* redirected */ }
})();
