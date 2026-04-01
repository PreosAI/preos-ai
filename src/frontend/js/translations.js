var _translations = {
  es: {
    'nav.comprar': 'Comprar',
    'nav.vender': 'Vender',
    'nav.agentes': 'Agentes de bienes ra\u00edces',
    'nav.mi-cuenta': 'Mi cuenta',
    'nav.ingresar': 'Ingresar',
    'hero.headline': 'La forma m\u00e1s f\u00e1cil de comprar\nuna propiedad, es con Preos',
    'hero.search-placeholder': 'Busca por ciudad, direcci\u00f3n o c\u00f3digo postal',
    'footer.explorar': 'Explorar',
    'footer.empresa': 'Empresa',
    'footer.legal': 'Legal',
  },
  en: {
    'nav.comprar': 'Buy',
    'nav.vender': 'Sell',
    'nav.agentes': 'Real Estate Agents',
    'nav.mi-cuenta': 'My account',
    'nav.ingresar': 'Sign in',
    'hero.headline': 'The easiest way to buy\na property, is with Preos',
    'hero.search-placeholder': 'Search by city, address or postal code',
    'footer.explorar': 'Explore',
    'footer.empresa': 'Company',
    'footer.legal': 'Legal',
  }
};

function applyLang(lang) {
  var t = _translations[lang] || _translations.es;
  localStorage.setItem('preos_lang', lang);
  // Update nav links by text content matching
  document.querySelectorAll('.nav-links a, .mobile-menu a').forEach(function(a) {
    var href = a.getAttribute('href') || '';
    if (href.indexOf('buscar') !== -1 && a.textContent.trim().match(/Comprar|Buy/)) a.textContent = t['nav.comprar'];
    else if (href.indexOf('vender') !== -1) a.textContent = t['nav.vender'];
    else if (href.indexOf('agentes') !== -1 || a.textContent.trim().match(/Agentes|Real Estate/)) a.textContent = t['nav.agentes'];
  });
  // Update search inputs placeholder
  document.querySelectorAll('input[placeholder*="ciudad"], input[placeholder*="city"]').forEach(function(inp) {
    inp.placeholder = t['hero.search-placeholder'];
  });
  // Update lang toggle display
  document.querySelectorAll('.lang-toggle').forEach(function(el) {
    el.innerHTML = lang === 'en' ? 'EN&nbsp;|&nbsp;<span style="opacity:.5">ES</span>' : '<span>ES</span>&nbsp;|&nbsp;EN';
  });
  // Hero headline
  var h1 = document.querySelector('.hero-headline');
  if (h1 && t['hero.headline']) {
    h1.innerHTML = t['hero.headline'].replace('\n', '<br>');
  }
  // Footer headings
  document.querySelectorAll('.footer-col h4').forEach(function(h4, i) {
    var keys = ['footer.explorar', 'footer.empresa', 'footer.legal'];
    if (keys[i] && t[keys[i]]) h4.textContent = t[keys[i]];
  });
}

function initLang() {
  var saved = localStorage.getItem('preos_lang') || 'es';
  applyLang(saved);
  document.querySelectorAll('.lang-toggle').forEach(function(el) {
    el.addEventListener('click', function() {
      var cur = localStorage.getItem('preos_lang') || 'es';
      applyLang(cur === 'es' ? 'en' : 'es');
    });
  });
}

document.addEventListener('DOMContentLoaded', initLang);
