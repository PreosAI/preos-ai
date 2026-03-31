/**
 * auth-nav.js — Firebase auth state observer for all pages.
 *
 * Expects Firebase compat SDK (app + auth) to be loaded before this script.
 * Updates #nav-mi-cuenta and #nav-ingresar-btn based on sign-in state.
 */

const _firebaseConfig = {
  apiKey: "AIzaSyD4w84FFevbFr-zo3KlFF1nB6cg4xAncss",
  authDomain: "preos-ai.firebaseapp.com",
  projectId: "preos-ai",
  storageBucket: "preos-ai.firebasestorage.app",
  messagingSenderId: "18950244981",
  appId: "1:18950244981:web:0f0244502b6b5ce05e063c"
};

// Initialize Firebase only once (ingresar.html may have already done it)
if (!firebase.apps.length) {
  firebase.initializeApp(_firebaseConfig);
}

firebase.auth().onAuthStateChanged(function(user) {
  const miCuenta = document.getElementById('nav-mi-cuenta');
  const ingresarBtn = document.getElementById('nav-ingresar-btn');

  if (!miCuenta || !ingresarBtn) return;

  if (user) {
    // Logged in: hide Ingresar, update Mi cuenta to show name + dropdown
    ingresarBtn.style.display = 'none';

    const firstName = (user.displayName || user.email || 'Usuario').split(' ')[0];
    const photoURL = user.photoURL;

    const avatarHTML = photoURL
      ? `<img src="${photoURL}" alt="${firstName}" style="width:26px;height:26px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:6px;">`
      : `<span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:var(--red,#cc1f1f);color:#fff;font-size:12px;font-weight:700;vertical-align:middle;margin-right:6px;">${firstName.charAt(0).toUpperCase()}</span>`;

    miCuenta.innerHTML = `
      <div class="auth-user-menu" style="position:relative;display:inline-block;">
        <button class="auth-user-btn" style="background:none;border:none;cursor:pointer;font-size:13px;font-weight:500;color:inherit;display:flex;align-items:center;gap:4px;padding:0;">
          ${avatarHTML}${firstName}
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style="opacity:.5;margin-left:2px;"><path d="M1 3l4 4 4-4"/></svg>
        </button>
        <div class="auth-dropdown" style="display:none;position:absolute;right:0;top:calc(100% + 8px);background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.1);min-width:160px;z-index:999;">
          <a href="dashboard.html" style="display:block;padding:10px 16px;font-size:13px;color:#1a1a1a;text-decoration:none;white-space:nowrap;">Mi cuenta</a>
          <a href="favoritos.html" style="display:block;padding:10px 16px;font-size:13px;color:#1a1a1a;text-decoration:none;white-space:nowrap;">Mis favoritos</a>
          <hr style="margin:4px 0;border:none;border-top:1px solid #f0f0f0;">
          <button id="btn-cerrar-sesion" style="width:100%;background:none;border:none;cursor:pointer;padding:10px 16px;font-size:13px;color:#cc1f1f;text-align:left;white-space:nowrap;">Cerrar sesión</button>
        </div>
      </div>`;

    // Toggle dropdown
    const btn = miCuenta.querySelector('.auth-user-btn');
    const dropdown = miCuenta.querySelector('.auth-dropdown');
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const open = dropdown.style.display === 'block';
      dropdown.style.display = open ? 'none' : 'block';
    });
    document.addEventListener('click', function() {
      dropdown.style.display = 'none';
    });

    // Sign out
    miCuenta.querySelector('#btn-cerrar-sesion').addEventListener('click', function() {
      firebase.auth().signOut().then(function() {
        window.location.href = 'ingresar.html';
      });
    });

  } else {
    // Not logged in: show default state
    ingresarBtn.style.display = '';
    miCuenta.innerHTML = `<a href="ingresar.html" style="font-size:13px;font-weight:500;color:inherit;text-decoration:none;">Mi cuenta</a>`;
  }
});
