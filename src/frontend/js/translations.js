(function () {
  var translations = {
    es: {
      'nav.comprar': 'Comprar',
      'nav.vender': 'Vender',
      'nav.agentes': 'Agentes de bienes raíces',
      'nav.micuenta': 'Mi cuenta',
      'nav.ingresar': 'Ingresar',
      'hero.title': 'La forma más fácil de comprar una propiedad, es con Preos',
      'hero.search': 'Busca por ciudad, dirección o código postal',
      'hero.comprar': 'Comprar',
      'hero.vender': 'Vender',
      'recommended.title': 'Propiedades que te recomendamos ver',
      'footer.explorar': 'EXPLORAR',
      'footer.empresa': 'EMPRESA',
      'footer.legal': 'LEGAL'
    },
    en: {
      'nav.comprar': 'Buy',
      'nav.vender': 'Sell',
      'nav.agentes': 'Real Estate Agents',
      'nav.micuenta': 'My account',
      'nav.ingresar': 'Sign in',
      'hero.title': 'The easiest way to buy a property, is with Preos',
      'hero.search': 'Search by city, address or postal code',
      'hero.comprar': 'Buy',
      'hero.vender': 'Sell',
      'recommended.title': 'Properties we recommend',
      'footer.explorar': 'EXPLORE',
      'footer.empresa': 'COMPANY',
      'footer.legal': 'LEGAL'
    }
  };

  function applyLang(lang) {
    var t = translations[lang] || translations.es;
    localStorage.setItem('preos_lang', lang);
    document.documentElement.lang = lang;

    // data-i18n text content
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (t[key] !== undefined) el.textContent = t[key];
    });

    // data-i18n-placeholder
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-placeholder');
      if (t[key] !== undefined) el.placeholder = t[key];
    });

    // Nav links by href — no need for data-i18n on every page's nav
    document.querySelectorAll('.nav-links a, .mobile-menu a').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (href.indexOf('buscar') !== -1) { a.textContent = t['nav.comprar']; return; }
      if (href.indexOf('vender') !== -1) { a.textContent = t['nav.vender']; return; }
      if (href.indexOf('agentes') !== -1) { a.textContent = t['nav.agentes']; return; }
    });

    // Mi cuenta link
    var miCuenta = document.getElementById('nav-mi-cuenta');
    if (miCuenta) {
      var mcLink = miCuenta.tagName === 'A' ? miCuenta : miCuenta.querySelector('a');
      if (mcLink) mcLink.textContent = t['nav.micuenta'];
    }

    // Ingresar button
    var ingresarBtn = document.getElementById('nav-ingresar-btn');
    if (ingresarBtn) ingresarBtn.textContent = t['nav.ingresar'];

    // Lang toggle display — bold the active language
    document.querySelectorAll('.lang-toggle').forEach(function (el) {
      if (lang === 'en') {
        el.innerHTML = '<strong>EN</strong>&nbsp;|&nbsp;<span style="opacity:.55;font-weight:500">ES</span>';
      } else {
        el.innerHTML = '<strong>ES</strong>&nbsp;|&nbsp;<span style="opacity:.55;font-weight:500">EN</span>';
      }
    });
  }

  function initLang() {
    var saved = localStorage.getItem('preos_lang') || 'es';
    applyLang(saved);
    document.querySelectorAll('.lang-toggle').forEach(function (el) {
      el.addEventListener('click', function () {
        var cur = localStorage.getItem('preos_lang') || 'es';
        applyLang(cur === 'es' ? 'en' : 'es');
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLang);
  } else {
    initLang();
  }
})();
