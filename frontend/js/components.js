async function loadNavbar() {
  const navbarPlaceholder = document.getElementById('navbar-placeholder');
  if (navbarPlaceholder) {
    const res = await fetch('components/navbar.html');
    const html = await res.text();
    navbarPlaceholder.innerHTML = html;
  }
}

function logout() {
  localStorage.removeItem('token');
  window.location.href = 'login.html';
}

window.addEventListener('DOMContentLoaded', loadNavbar);