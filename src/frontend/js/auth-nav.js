/**
 * auth-nav.js — Firebase auth state + language toggle for all pages.
 *
 * Requires:
 *   - Firebase compat SDK (app + auth) loaded before this script
 *   - js/lang.js loaded before or after (both orderings are safe)
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

/* ─────────────────────────────────────────────────────────────────
   Ensure a .lang-toggle button exists in .nav-right
   (pages that don't hard-code it in HTML will get one injected)
──────────────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────
   Sync auth button / Mi cuenta link colour to match nav link colour.
   On red-background pages the nav links are white; on white-background
   pages they are dark. Reading the computed colour of an existing nav
   link and applying it directly avoids any CSS inheritance gap.
──────────────────────────────────────────────────────────────────── */
function _syncAuthButtonColor() {
  var navLink = document.querySelector('.nav-links a');
  if (!navLink) return;
  var color = window.getComputedStyle(navLink).color;

  // Logged-in state: the auth-user-btn button
  var authBtn = document.querySelector('.auth-user-btn');
  if (authBtn) authBtn.style.color = color;

  // Logged-out state: the plain Mi cuenta anchor
  var miCuenta = document.getElementById('nav-mi-cuenta');
  if (miCuenta && !miCuenta.querySelector('.auth-user-btn')) {
    var link = miCuenta.querySelector('a');
    if (link) link.style.color = color;
  }
}

function _ensureLangToggle() {
  if (document.querySelector('.lang-toggle')) return; // already in HTML

  var navRight = document.querySelector('.nav-right');
  if (!navRight) return;

  var toggle = document.createElement('div');
  toggle.className = 'lang-toggle';
  toggle.style.cssText = 'font-size:13px;font-weight:500;cursor:pointer;user-select:none;white-space:nowrap;';
  toggle.innerHTML = '<strong>ES</strong>&nbsp;|&nbsp;<span style="opacity:.45;font-weight:500">EN</span>';

  // Insert before the first child (so it appears left of the login button)
  navRight.insertBefore(toggle, navRight.firstChild);
}

/* ─────────────────────────────────────────────────────────────────
   Auth state observer
──────────────────────────────────────────────────────────────────── */
firebase.auth().onAuthStateChanged(function (user) {
  const miCuenta   = document.getElementById('nav-mi-cuenta');
  const ingresarBtn = document.getElementById('nav-ingresar-btn');

  if (!miCuenta || !ingresarBtn) return;

  if (user) {
    ingresarBtn.style.display = 'none';

    const firstName = (user.displayName || user.email || 'Usuario').split(' ')[0];
    const photoURL  = user.photoURL;

    const avatarHTML = photoURL
      ? `<img src="${photoURL}" alt="${firstName}" style="width:26px;height:26px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:6px;">`
      : `<span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:var(--red,#cc1f1f);color:#fff;font-size:12px;font-weight:700;vertical-align:middle;margin-right:6px;">${firstName.charAt(0).toUpperCase()}</span>`;

    const myAccountLabel  = window.PreosLang ? window.PreosLang.t('nav_myaccount')  : 'Mi cuenta';
    const myFavsLabel     = window.PreosLang ? window.PreosLang.t('nav_myfavs')     : 'Mis favoritos';
    const myVisitsLabel   = window.PreosLang ? window.PreosLang.t('myVisits')        : 'Mis visitas';
    const signOutLabel    = window.PreosLang ? window.PreosLang.t('nav_signout')     : 'Cerrar sesión';

    const isAgent = !!(user.email && user.email.endsWith('@preos.ai'));
    const agentCrmHTML = isAgent
      ? `<a href="agente-dashboard.html" id="nav-crm-link" style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;font-size:13px;color:#cc1f1f;text-decoration:none;white-space:nowrap;font-weight:600;">
          🔐 CRM Agente
          <span id="crm-unread-badge" style="display:none;background:#E51B27;color:#fff;border-radius:999px;font-size:11px;font-weight:700;padding:1px 7px;margin-left:8px;min-width:18px;text-align:center;"></span>
        </a>`
      : '';

    miCuenta.innerHTML = `
      <div class="auth-user-menu" style="position:relative;display:inline-block;">
        <button class="auth-user-btn" style="background:none;border:none;cursor:pointer;font-size:13px;font-weight:500;color:inherit;display:flex;align-items:center;gap:4px;padding:0;">
          ${avatarHTML}${firstName}
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style="opacity:.5;margin-left:2px;"><path d="M1 3l4 4 4-4"/></svg>
        </button>
        <div class="auth-dropdown" style="display:none;position:absolute;right:0;top:calc(100% + 8px);background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.1);min-width:180px;z-index:999;">
          <a href="dashboard.html" style="display:block;padding:10px 16px;font-size:13px;color:#1a1a1a;text-decoration:none;white-space:nowrap;">${myAccountLabel}</a>
          <a href="favoritos.html" style="display:block;padding:10px 16px;font-size:13px;color:#1a1a1a;text-decoration:none;white-space:nowrap;">${myFavsLabel}</a>
          <a href="visitas.html" style="display:block;padding:10px 16px;font-size:13px;color:#1a1a1a;text-decoration:none;white-space:nowrap;">${myVisitsLabel}</a>
          ${agentCrmHTML}
          <hr style="margin:4px 0;border:none;border-top:1px solid #f0f0f0;">
          <button id="btn-cerrar-sesion" style="width:100%;background:none;border:none;cursor:pointer;padding:10px 16px;font-size:13px;color:#cc1f1f;text-align:left;white-space:nowrap;">${signOutLabel}</button>
        </div>
      </div>`;

    // Toggle dropdown
    const btn      = miCuenta.querySelector('.auth-user-btn');
    const dropdown = miCuenta.querySelector('.auth-dropdown');
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
    });
    document.addEventListener('click', function () {
      dropdown.style.display = 'none';
    });

    // Sign out
    miCuenta.querySelector('#btn-cerrar-sesion').addEventListener('click', function () {
      firebase.auth().signOut().then(function () {
        window.location.href = 'ingresar.html';
      });
    });

    // Agent: load unread badge count
    if (isAgent) loadUnreadCount();

  } else {
    // Not logged in
    ingresarBtn.style.display = '';
    const myAccountLabel = window.PreosLang ? window.PreosLang.t('nav_myaccount') : 'Mi cuenta';
    miCuenta.innerHTML = `<a href="ingresar.html" style="font-size:13px;font-weight:500;color:inherit;text-decoration:none;">${myAccountLabel}</a>`;
  }

  // Re-apply translations now that auth DOM has settled
  if (window.PreosLang) window.PreosLang.init();

  // Sync auth display colour to match nav link colour
  _syncAuthButtonColor();
});

/* ─────────────────────────────────────────────────────────────────
   Agent: unread lead count badge
──────────────────────────────────────────────────────────────────── */
function loadUnreadCount() {
  if (typeof firebase === 'undefined' || typeof firebase.firestore !== 'function') return;
  firebase.firestore().collection('bookings').get().then(function(snap) {
    var count = 0;
    snap.forEach(function(doc) {
      var d = doc.data();
      if (d.status === 'pending' && (!d.agentStatus || d.agentStatus === 'nuevo')) count++;
    });
    var badge = document.getElementById('crm-unread-badge');
    if (badge && count > 0) {
      badge.textContent = count;
      badge.style.display = 'inline-block';
    }
  }).catch(function() {});
}

/* ─────────────────────────────────────────────────────────────────
   On DOMContentLoaded: inject toggle if needed, init lang
──────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
  _ensureLangToggle();
  if (window.PreosLang) window.PreosLang.init();

  // Re-sync auth colour when nav scroll state changes (e.g. red → white on scroll)
  var _navEl = document.querySelector('nav');
  if (_navEl) {
    new MutationObserver(_syncAuthButtonColor).observe(_navEl, {
      attributes: true,
      attributeFilter: ['class']
    });
  }
});

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js')
      .then(function (reg) {
        console.log('[Preos PWA] SW registered:', reg.scope);
        reg.addEventListener('updatefound', function () {
          var newWorker = reg.installing;
          newWorker.addEventListener('statechange', function () {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              newWorker.postMessage('skipWaiting');
            }
          });
        });
      })
      .catch(function (err) { console.warn('[Preos PWA] SW failed:', err); });

    // Force clear old caches on every load so PWA always gets fresh content
    if ('caches' in window) {
      caches.keys().then(function(keys) {
        keys.filter(function(k) { return !k.includes('v3'); }).forEach(function(k) { caches.delete(k); });
      });
    }
  });
}

// PWA Install Prompt (Android/Chrome only — iOS uses Safari share sheet)
var _deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault();
  _deferredInstallPrompt = e;

  var isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
  var isStandalone = window.matchMedia('(display-mode: standalone)').matches;

  if (isMobile && !isStandalone && !sessionStorage.getItem('pwa-prompt-dismissed')) {
    var banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.innerHTML = [
      '<div style="',
        'position:fixed;bottom:16px;left:16px;right:16px;z-index:9999;',
        'background:#1a1a1a;color:#fff;border-radius:12px;',
        'padding:14px 16px;display:flex;align-items:center;gap:12px;',
        'box-shadow:0 4px 20px rgba(0,0,0,0.3);font-family:inherit;',
      '">',
        '<img src="/icons/icon-192.png" style="width:40px;height:40px;border-radius:8px;flex-shrink:0;">',
        '<div style="flex:1;min-width:0;">',
          '<div style="font-size:14px;font-weight:600;margin-bottom:2px;">Instalar Preos</div>',
          '<div style="font-size:12px;opacity:0.7;">Añade la app a tu pantalla de inicio</div>',
        '</div>',
        '<button id="pwa-install-btn" style="',
          'background:#E51B27;color:#fff;border:none;border-radius:8px;',
          'padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;flex-shrink:0;',
        '">Instalar</button>',
        '<button id="pwa-dismiss-btn" style="',
          'background:transparent;color:#fff;border:none;',
          'font-size:20px;cursor:pointer;padding:0 4px;opacity:0.6;flex-shrink:0;',
        '">×</button>',
      '</div>'
    ].join('');
    document.body.appendChild(banner);

    document.getElementById('pwa-install-btn').addEventListener('click', function () {
      _deferredInstallPrompt.prompt();
      _deferredInstallPrompt.userChoice.then(function () {
        banner.remove();
        _deferredInstallPrompt = null;
      });
    });

    document.getElementById('pwa-dismiss-btn').addEventListener('click', function () {
      banner.remove();
      sessionStorage.setItem('pwa-prompt-dismissed', '1');
    });
  }
});
