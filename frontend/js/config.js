// frontend/js/config.js
window.API = {
  url: (path) => {
    if (!path.startsWith('/')) path = '/' + path;
    return path; // same-origin
  }
};
