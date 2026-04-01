/**
 * lang.js — Global bilingual translation system for Preos.
 *
 * Usage:
 *   window.PreosLang.t('nav_buy')          → current-language string
 *   window.setLang('en')                   → switch language
 *   <span data-i18n="nav_buy">            → auto-translated text node
 *   <input data-i18n-placeholder="nav_search_placeholder">
 */

window.PreosLang = (function () {

  /* ─────────────────────────────────────────────────────────────────
     String table
  ──────────────────────────────────────────────────────────────────── */
  var strings = {
    es: {
      // Nav
      nav_buy:                'Comprar',
      nav_sell:               'Vender',
      nav_agents:             'Agentes de bienes raíces',
      nav_why:                '¿Por qué Preos?',
      nav_signin:             'Ingresar',
      nav_myaccount:          'Mi cuenta',
      nav_myfavs:             'Mis favoritos',
      nav_signout:            'Cerrar sesión',
      nav_search_placeholder: 'Busca por ciudad, dirección o código postal',

      // Hero
      hero_title_1:   'La forma más fácil de comprar',
      hero_title_2:   'una propiedad, es con Preos',
      hero_subtitle:  'Precio real, agentes con salario fijo y datos en tiempo real. Sin sorpresas.',
      hero_cta_search:'Buscar propiedades',
      hero_cta_sell:  'Vender mi propiedad',

      // Marketing banner
      banner_savings_label:   'de ahorro medio por operación',
      banner_savings_caption: 'Sin comisiones ocultas ni letra pequeña',

      // Home marketing banner
      home_eyebrow:   'Costa del Sol · Málaga',
      home_hero_title:'Tu próxima casa. Sin comisiones que te roben el sueño.',
      home_hero_sub:  'Hasta un 70% menos en comisiones. Agentes asalariados. Transparencia total.',
      home_hero_badge:'Ahorro medio: €17.500',
      home_hero_cta:  '¿Por qué Preos?',
      home_hero_cta2: 'Ver todas las propiedades →',

      // Agentes page
      agents_hero_title:       'Agentes que trabajan para ti, no por su comisión.',
      agents_hero_sub:         'En Preos, nuestros agentes cobran salario fijo. Su único incentivo es que tú estés satisfecho.',
      agents_stat1_val:        '24/7',
      agents_stat1_label:      'Disponibilidad',
      agents_stat2_val:        'NPS >80',
      agents_stat2_label:      'Satisfacción objetivo',
      agents_stat3_val:        '0€',
      agents_stat3_label:      'Comisión oculta',
      agents_model_title:      '¿Por qué importa el modelo de salario?',
      agents_model_body:       'Un agente tradicional cobra solo si vende, y cuanto más alto el precio, mejor para él. Eso crea un conflicto de interés directo con el comprador. En Preos, eliminamos ese conflicto: nuestros agentes cobran sueldo fijo y bonus por satisfacción del cliente (NPS). El resultado: más honestidad, menos presión, mejores decisiones.',
      agents_pillars_tag:      'Por qué Preos',
      agents_pillars_heading:  'Un modelo diferente',
      agents_p1_title:         'Salario fijo, sin comisiones',
      agents_p1_desc:          'Olvídate de la presión de vender para cobrar. En Preos cobrarás un salario competitivo para que te centres en lo que importa: el cliente.',
      agents_p2_title:         'Éxito medido por satisfacción',
      agents_p2_desc:          'Tu desempeño se mide por las valoraciones de tus clientes, no por el número de ventas. Calidad sobre cantidad.',
      agents_p3_title:         'Crece con nosotros',
      agents_p3_desc:          'Formación continua, herramientas digitales de última generación y un equipo que te apoya en cada paso.',
      agents_req_tag:          'Requisitos',
      agents_req_heading:      '¿Qué buscamos?',
      agents_req1:             'Experiencia en inmobiliaria o atención al cliente',
      agents_req2:             'Pasión por ayudar a las personas',
      agents_req3:             'Basado/a en la zona de Málaga',
      agents_req_cta:          'Solicitar información',
      agents_modal_title:      'Solicitar información',
      agents_form_name:        'Nombre',
      agents_form_name_ph:     'Tu nombre completo',
      agents_form_email:       'Email',
      agents_form_phone:       'Teléfono',
      agents_form_exp:         'Años de experiencia',
      agents_form_exp_ph:      'Selecciona...',
      agents_form_submit:      'Enviar solicitud',

      // Why Preos page — hero
      why_hero_title: 'El mercado inmobiliario lleva décadas sin cambiar. Nosotros lo cambiamos.',
      why_hero_sub:   'Agentes asalariados, tecnología transparente, y hasta un 70% menos en comisiones.',
      why_hero_cta1:  'Ver propiedades',
      why_hero_cta2:  'Vender con Preos',

      // Why Preos page — savings banner
      why_savings_stat:    '€17.500',
      why_savings_label:   'Ahorro medio en una vivienda de €500.000 en Costa del Sol',
      why_savings_caption: 'Frente a una agencia tradicional con comisión del 6%',

      // Why Preos page — pillars section
      why_pillars_title:  'Una forma diferente de trabajar',
      why_p1_title: 'Precio justo',
      why_p1_desc:  '1,5–2% para propiedades exclusivas Preos. Sin letra pequeña, sin honorarios ocultos.',
      why_p2_title: 'Transparencia total',
      why_p2_desc:  'Datos verificados, precios reales y el proceso siempre visible.',
      why_p3_title: 'Agentes de tu lado',
      why_p3_desc:  'Nuestros agentes cobran sueldo fijo. Su objetivo es tu satisfacción, no cerrar la venta más rápida.',

      // Why Preos page — comparison table
      why_compare_title:       'Tradicional vs. Preos',
      why_compare_aspect:      'Aspecto',
      why_compare_traditional: 'Agencia tradicional',
      why_compare_preos:       'Preos',
      why_row1_aspect:  'Comisión',
      why_row1_trad:    '5–8% (hasta €40.000)',
      why_row1_preos:   '1,5–2% exclusivas / ~2,5% co-agencia',
      why_row2_aspect:  'Incentivo agente',
      why_row2_trad:    'Cerrar rápido, cobrar más',
      why_row2_preos:   'Salario fijo + satisfacción',
      why_row3_aspect:  'Transparencia',
      why_row3_trad:    'Opaca, sin datos reales',
      why_row3_preos:   'Precios verificados y visibles',
      why_row4_aspect:  'Disponibilidad',
      why_row4_trad:    'Horario limitado',
      why_row4_preos:   'Chat y llamada 24/7',
      why_row5_aspect:  'Tecnología',
      why_row5_trad:    'Webs anticuadas',
      why_row5_preos:   'Plataforma IA',

      // Why Preos page — calculator
      why_calc_title:       '¿Cuánto ahorras con Preos?',
      why_calc_label:       'Precio de la propiedad',
      why_calc_trad_label:  'Comisión tradicional (6%)',
      why_calc_preos_label: 'Comisión Preos (1,75%)',
      why_calc_save_label:  'Tu ahorro',

      // Why Preos page — agents
      why_agents_title:    'Nuestros agentes',
      why_agents_sub:      'Profesionales certificados con salario fijo. Trabajan para ti, no para la comisión.',
      why_agents_badge:    'Salario fijo',

      // Why Preos page — final CTA
      why_cta_title:    'Empieza hoy. Sin compromiso.',
      why_cta_sub:      'Explora propiedades, habla con un agente o solicita una valoración gratuita. Sin presión.',
      why_cta_btn1:     'Ver propiedades',
      why_cta_btn2:     'Vender',

      // Why Preos section (used on other pages)
      why_eyebrow:  'Por qué Preos',
      why_title:    'Compramos diferente',
      why_subtitle: 'Una plataforma construida desde cero para ponerse del lado del comprador.',

      // Pillars
      pillar1_title: 'Precios reales',
      pillar1_desc:  'Accede al historial de precios y estimaciones de valor de cada propiedad. Sin sorpresas ni datos inventados.',
      pillar2_title: 'Agentes con salario fijo',
      pillar2_desc:  'Nuestros agentes cobran salario, no comisiones. Su único objetivo es que estés feliz con tu decisión.',
      pillar3_title: 'Datos en tiempo real',
      pillar3_desc:  'Conectados a las principales fuentes del mercado español para que siempre estés un paso adelante.',

      // Comparison table
      compare_title:       'Preos vs. agencia tradicional',
      compare_aspect:      'Aspecto',
      compare_traditional: 'Agencia tradicional',
      compare_preos:       'Preos',

      // Savings calculator
      calc_title:        '¿Cuánto puedes ahorrar?',
      calc_label:        'Precio de la propiedad',
      calc_trad_label:   'Comisión tradicional (5%)',
      calc_preos_label:  'Tarifa Preos (1,5%)',
      calc_saving_label: 'Tu ahorro estimado',

      // Agents
      agents_title:        'Nuestros agentes',
      agents_subtitle:     'Profesionales certificados con salario fijo. Trabajan para ti, no para la comisión.',
      agents_salary_badge: 'Salario fijo',

      // Sell page
      sell_title:    'Vende con Preos',
      sell_subtitle: 'Pon tu propiedad en el mercado con la plataforma más transparente de España.',

      // Footer
      footer_tagline: 'La plataforma inmobiliaria más fácil de España.',
      footer_rights:  '© 2026 Preos. Todos los derechos reservados.',

      // Buscar page
      buscar_results: 'resultados',
      buscar_in:      'en Málaga',

      // Property page
      prop_contact_agent: 'Contactar agente',
      prop_book_visit:    'Programar recorrido',
      prop_tour_3d:       'Recorrido 3D',

      // Misc
      recommended_title: 'Propiedades que te recomendamos ver',

      // Footer headings
      footer_explore: 'EXPLORAR',
      footer_company: 'EMPRESA',
      footer_legal:   'LEGAL',

      // Backward-compat dotted keys used by data-i18n attributes on existing pages
      'nav.comprar':        'Comprar',
      'nav.vender':         'Vender',
      'nav.agentes':        'Agentes de bienes raíces',
      'nav.micuenta':       'Mi cuenta',
      'nav.ingresar':       'Ingresar',
      'hero.title':         'La forma más fácil de comprar una propiedad, es con Preos',
      'hero.search':        'Busca por ciudad, dirección o código postal',
      'hero.comprar':       'Comprar',
      'hero.vender':        'Vender',
      'recommended.title':  'Propiedades que te recomendamos ver',
      'footer.explorar':    'EXPLORAR',
      'footer.empresa':     'EMPRESA',
      'footer.legal':       'LEGAL',
    },

    en: {
      // Nav
      nav_buy:                'Buy',
      nav_sell:               'Sell',
      nav_agents:             'Real Estate Agents',
      nav_why:                'Why Preos',
      nav_signin:             'Sign in',
      nav_myaccount:          'My account',
      nav_myfavs:             'Saved properties',
      nav_signout:            'Sign out',
      nav_search_placeholder: 'Search by city, address or postal code',

      // Hero
      hero_title_1:   'The easiest way to buy',
      hero_title_2:   'a property — with Preos',
      hero_subtitle:  'Honest pricing, salaried agents, real-time market data. No surprises, ever.',
      hero_cta_search:'Browse properties',
      hero_cta_sell:  'Sell my property',

      // Marketing banner
      banner_savings_label:   'average savings per transaction',
      banner_savings_caption: 'No hidden fees, no small print',

      // Home marketing banner
      home_eyebrow:   'Costa del Sol · Málaga',
      home_hero_title:'Your next home. Without fees that steal your dreams.',
      home_hero_sub:  'Up to 70% less in fees. Salaried agents. Total transparency.',
      home_hero_badge:'Average saving: €17,500',
      home_hero_cta:  'Why Preos?',
      home_hero_cta2: 'Browse all properties →',

      // Agentes page
      agents_hero_title:       'Agents working for you, not their commission.',
      agents_hero_sub:         'At Preos, our agents earn a fixed salary. Their only incentive is your satisfaction.',
      agents_stat1_val:        '24/7',
      agents_stat1_label:      'Availability',
      agents_stat2_val:        'NPS >80',
      agents_stat2_label:      'Target satisfaction',
      agents_stat3_val:        '€0',
      agents_stat3_label:      'Hidden fees',
      agents_model_title:      'Why does the salary model matter?',
      agents_model_body:       'A traditional agent only earns if they sell — and the higher the price, the better for them. That creates a direct conflict of interest with you. At Preos, we eliminate that conflict: our agents earn a fixed salary and bonuses tied to client satisfaction (NPS). The result: more honesty, less pressure, better decisions.',
      agents_pillars_tag:      'Why Preos',
      agents_pillars_heading:  'A different model',
      agents_p1_title:         'Fixed salary, no commissions',
      agents_p1_desc:          'Forget the pressure of selling to get paid. At Preos you earn a competitive salary so you can focus on what matters: the client.',
      agents_p2_title:         'Success measured by satisfaction',
      agents_p2_desc:          'Your performance is measured by client reviews, not sales volume. Quality over quantity.',
      agents_p3_title:         'Grow with us',
      agents_p3_desc:          'Ongoing training, cutting-edge digital tools, and a team that supports you at every step.',
      agents_req_tag:          'Requirements',
      agents_req_heading:      'What are we looking for?',
      agents_req1:             'Experience in real estate or customer service',
      agents_req2:             'Passion for helping people',
      agents_req3:             'Based in the Málaga area',
      agents_req_cta:          'Request information',
      agents_modal_title:      'Request information',
      agents_form_name:        'Name',
      agents_form_name_ph:     'Your full name',
      agents_form_email:       'Email',
      agents_form_phone:       'Phone',
      agents_form_exp:         'Years of experience',
      agents_form_exp_ph:      'Select...',
      agents_form_submit:      'Send request',

      // Why Preos page — hero
      why_hero_title: "Real estate hasn't changed in decades. We're changing it.",
      why_hero_sub:   'Salaried agents, transparent technology, and up to 70% less in fees.',
      why_hero_cta1:  'See properties',
      why_hero_cta2:  'Sell with Preos',

      // Why Preos page — savings banner
      why_savings_stat:    '€17,500',
      why_savings_label:   'Average saving on a €500,000 home in Costa del Sol',
      why_savings_caption: 'Compared to a traditional agency charging 6%',

      // Why Preos page — pillars section
      why_pillars_title:  'A different way to work',
      why_p1_title: 'Fair pricing',
      why_p1_desc:  '1.5–2% for Preos exclusive listings. No hidden fees, no surprises.',
      why_p2_title: 'Total transparency',
      why_p2_desc:  'Verified data, real prices, and your process visible at every step.',
      why_p3_title: 'Agents on your side',
      why_p3_desc:  'Our agents earn a fixed salary. Their goal is your satisfaction, not the fastest sale.',

      // Why Preos page — comparison table
      why_compare_title:       'Traditional vs. Preos',
      why_compare_aspect:      'Aspect',
      why_compare_traditional: 'Traditional agency',
      why_compare_preos:       'Preos',
      why_row1_aspect:  'Commission',
      why_row1_trad:    '5–8% (up to €40,000)',
      why_row1_preos:   '1.5–2% exclusive / ~2.5% co-agency',
      why_row2_aspect:  'Agent incentive',
      why_row2_trad:    'Close fast, earn more',
      why_row2_preos:   'Fixed salary + satisfaction',
      why_row3_aspect:  'Transparency',
      why_row3_trad:    'Opaque, no real data',
      why_row3_preos:   'Verified prices, always visible',
      why_row4_aspect:  'Availability',
      why_row4_trad:    'Limited hours',
      why_row4_preos:   'Chat & call 24/7',
      why_row5_aspect:  'Technology',
      why_row5_trad:    'Outdated websites',
      why_row5_preos:   'AI-powered platform',

      // Why Preos page — calculator
      why_calc_title:       'How much do you save with Preos?',
      why_calc_label:       'Property price',
      why_calc_trad_label:  'Traditional commission (6%)',
      why_calc_preos_label: 'Preos commission (1.75%)',
      why_calc_save_label:  'Your saving',

      // Why Preos page — agents
      why_agents_title:    'Our agents',
      why_agents_sub:      'Certified professionals on a fixed salary. They work for you, not for a cut.',
      why_agents_badge:    'Fixed salary',

      // Why Preos page — final CTA
      why_cta_title:    'Start today. No commitment.',
      why_cta_sub:      'Browse properties, talk to an agent, or request a free valuation. No pressure.',
      why_cta_btn1:     'See properties',
      why_cta_btn2:     'Sell',

      // Why Preos section (used on other pages)
      why_eyebrow:  'Why Preos',
      why_title:    'A smarter way to buy',
      why_subtitle: 'A platform built from the ground up to put the buyer first — always.',

      // Pillars
      pillar1_title: 'Real prices',
      pillar1_desc:  'Access full price history and independent valuation estimates for every listing. No guesswork.',
      pillar2_title: 'Salaried agents',
      pillar2_desc:  'Our agents earn a fixed salary, not commissions. Their only metric is your satisfaction.',
      pillar3_title: 'Real-time data',
      pillar3_desc:  "Connected to Spain's leading property data sources so you're always one step ahead of the market.",

      // Comparison table
      compare_title:       'Preos vs. traditional agency',
      compare_aspect:      'Aspect',
      compare_traditional: 'Traditional agency',
      compare_preos:       'Preos',

      // Savings calculator
      calc_title:        'How much could you save?',
      calc_label:        'Property price',
      calc_trad_label:   'Traditional commission (5%)',
      calc_preos_label:  'Preos fee (1.5%)',
      calc_saving_label: 'Your estimated savings',

      // Agents
      agents_title:        'Our agents',
      agents_subtitle:     'Certified professionals on a fixed salary. They work for you, not for a cut.',
      agents_salary_badge: 'Fixed salary',

      // Sell page
      sell_title:    'Sell with Preos',
      sell_subtitle: "List your property on Spain's most transparent real estate platform.",

      // Footer
      footer_tagline: "Spain's most straightforward property platform.",
      footer_rights:  '© 2026 Preos. All rights reserved.',

      // Buscar page
      buscar_results: 'results',
      buscar_in:      'in Málaga',

      // Property page
      prop_contact_agent: 'Contact agent',
      prop_book_visit:    'Schedule a visit',
      prop_tour_3d:       '3D Tour',

      // Misc
      recommended_title: 'Properties we recommend',

      // Footer headings
      footer_explore: 'EXPLORE',
      footer_company: 'COMPANY',
      footer_legal:   'LEGAL',

      // Backward-compat dotted keys
      'nav.comprar':        'Buy',
      'nav.vender':         'Sell',
      'nav.agentes':        'Real Estate Agents',
      'nav.micuenta':       'My account',
      'nav.ingresar':       'Sign in',
      'hero.title':         'The easiest way to buy a property, is with Preos',
      'hero.search':        'Search by city, address or postal code',
      'hero.comprar':       'Buy',
      'hero.vender':        'Sell',
      'recommended.title':  'Properties we recommend',
      'footer.explorar':    'EXPLORE',
      'footer.empresa':     'COMPANY',
      'footer.legal':       'LEGAL',
    }
  };

  /* ─────────────────────────────────────────────────────────────────
     State
  ──────────────────────────────────────────────────────────────────── */
  var _lang = 'es';

  /* ─────────────────────────────────────────────────────────────────
     Language detection
  ──────────────────────────────────────────────────────────────────── */
  function detectLang() {
    // 1. localStorage
    var stored = localStorage.getItem('preos-lang');
    if (stored === 'en' || stored === 'es') return stored;

    // Also check the old key used by translations.js for backwards compat
    var storedOld = localStorage.getItem('preos_lang');
    if (storedOld === 'en' || storedOld === 'es') return storedOld;

    // 2. Browser language
    var nav = (navigator.language || navigator.userLanguage || '').toLowerCase();
    if (nav.startsWith('en')) return 'en';

    // 3. Default
    return 'es';
  }

  /* ─────────────────────────────────────────────────────────────────
     Render — apply translations to the current DOM
  ──────────────────────────────────────────────────────────────────── */
  function render(lang) {
    var t = strings[lang] || strings.es;

    // <html lang>
    document.documentElement.lang = lang;

    // data-i18n text nodes
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (t[key] !== undefined) el.textContent = t[key];
    });

    // data-i18n-placeholder
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-placeholder');
      if (t[key] !== undefined) el.placeholder = t[key];
    });

    // Nav links — matched by href so no data-i18n needed on every page
    document.querySelectorAll('.nav-links a, .mobile-menu a').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (href.indexOf('buscar') !== -1) { a.textContent = t.nav_buy;    return; }
      if (href.indexOf('vender') !== -1) { a.textContent = t.nav_sell;   return; }
      if (href.indexOf('agentes') !== -1){ a.textContent = t.nav_agents; return; }
    });

    // #nav-ingresar-btn
    var ingresarBtn = document.getElementById('nav-ingresar-btn');
    if (ingresarBtn) ingresarBtn.textContent = t.nav_signin;

    // #nav-mi-cuenta — only update if it's the logged-out plain link
    var miCuenta = document.getElementById('nav-mi-cuenta');
    if (miCuenta) {
      var mcLink = miCuenta.tagName === 'A' ? miCuenta : miCuenta.querySelector('a:not([href="dashboard.html"])');
      // only touch the simple "Mi cuenta" link, not the auth dropdown
      if (mcLink && !miCuenta.querySelector('.auth-user-btn')) {
        mcLink.textContent = t.nav_myaccount;
      }
    }

    // Lang toggle appearance
    document.querySelectorAll('.lang-toggle').forEach(function (el) {
      el.innerHTML = lang === 'en'
        ? '<strong>EN</strong>&nbsp;|&nbsp;<span style="opacity:.45;font-weight:500">ES</span>'
        : '<strong>ES</strong>&nbsp;|&nbsp;<span style="opacity:.45;font-weight:500">EN</span>';
    });
  }

  /* ─────────────────────────────────────────────────────────────────
     Public API
  ──────────────────────────────────────────────────────────────────── */

  /** Translate a single key in the current language. */
  function t(key) {
    var dict = strings[_lang] || strings.es;
    return dict[key] !== undefined ? dict[key] : key;
  }

  /** Switch language, persist, and re-render the page. */
  function setLang(lang) {
    if (lang !== 'en' && lang !== 'es') return;
    _lang = lang;
    localStorage.setItem('preos-lang', lang);
    localStorage.setItem('preos_lang', lang); // keep old key in sync
    render(lang);
  }

  /** Detect language, render, and wire toggle click handlers.
   *  Idempotent — safe to call multiple times. */
  function init() {
    _lang = detectLang();
    render(_lang);

    document.querySelectorAll('.lang-toggle').forEach(function (el) {
      // Remove any existing listener by cloning (prevents double-binding)
      var fresh = el.cloneNode(true);
      el.parentNode.replaceChild(fresh, el);
      fresh.addEventListener('click', function () {
        setLang(_lang === 'es' ? 'en' : 'es');
      });
    });
  }

  /* ─────────────────────────────────────────────────────────────────
     Auto-init on DOMContentLoaded
  ──────────────────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init: init, setLang: setLang, t: t, strings: strings };

})();

/** Convenience global so inline onclick="setLang('en')" works. */
window.setLang = function (lang) { window.PreosLang.setLang(lang); };
