const CONSENT_KEY = 'preos_cookie_consent';
const CONSENT_DATE_KEY = 'preos_cookie_consent_date';
const GA_ID = 'G-7JMBMFMSEZ';

function loadGA4() {
  if (document.getElementById('preos-ga4-script')) return;
  const script = document.createElement('script');
  script.id = 'preos-ga4-script';
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  document.head.appendChild(script);
  script.onload = function() {
    window.dataLayer = window.dataLayer || [];
    function gtag(){ dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', GA_ID, { anonymize_ip: true });
  };
}

function hideBanner() {
  const b = document.getElementById('preos-cookie-banner');
  if (b) b.remove();
}

function acceptCookies() {
  localStorage.setItem(CONSENT_KEY, 'accepted');
  localStorage.setItem(CONSENT_DATE_KEY, new Date().toISOString());
  hideBanner();
  loadGA4();
}

function rejectCookies() {
  localStorage.setItem(CONSENT_KEY, 'rejected');
  localStorage.setItem(CONSENT_DATE_KEY, new Date().toISOString());
  hideBanner();
}

function showBanner() {
  const lang = localStorage.getItem('preos-lang') || localStorage.getItem('preos_lang') || 'es';
  const texts = {
    es: {
      msg: '<strong>Usamos cookies analíticas</strong> para mejorar tu experiencia en Preos. Puedes aceptarlas o rechazarlas. Las cookies estrictamente necesarias siempre están activas.',
      more: 'Más información',
      reject: 'Rechazar',
      accept: 'Aceptar'
    },
    en: {
      msg: '<strong>We use analytics cookies</strong> to improve your experience on Preos. You can accept or reject them. Strictly necessary cookies are always active.',
      more: 'More information',
      reject: 'Reject',
      accept: 'Accept'
    }
  };
  const t = texts[lang] || texts.es;
  const banner = document.createElement('div');
  banner.id = 'preos-cookie-banner';
  banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#1a1a2e;color:#ffffff;padding:16px 24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;line-height:1.5;border-top:3px solid #E51B27;';
  banner.innerHTML = '<div style="flex:1;min-width:200px;max-width:700px;">' + t.msg + ' <a href="/cookies.html" style="color:#E51B27;text-decoration:underline;margin-left:4px;">' + t.more + '</a></div><div style="display:flex;gap:10px;flex-shrink:0;"><button id="preos-cookie-reject" style="padding:9px 20px;border-radius:6px;font-size:14px;font-weight:500;cursor:pointer;border:2px solid #ffffff;background:transparent;color:#ffffff;min-width:100px;">' + t.reject + '</button><button id="preos-cookie-accept" style="padding:9px 20px;border-radius:6px;font-size:14px;font-weight:500;cursor:pointer;border:2px solid #E51B27;background:#E51B27;color:#ffffff;min-width:100px;">' + t.accept + '</button></div>';
  document.body.appendChild(banner);
  document.getElementById('preos-cookie-accept').addEventListener('click', acceptCookies);
  document.getElementById('preos-cookie-reject').addEventListener('click', rejectCookies);
}

function initCookieConsent() {
  const consent = localStorage.getItem(CONSENT_KEY);
  if (consent === 'accepted') {
    loadGA4();
  } else if (!consent) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showBanner);
    } else {
      showBanner();
    }
  }
}

initCookieConsent();
