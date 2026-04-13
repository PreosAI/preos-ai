// GA4 loading controlled by js/cookie-consent.js — do not load gtag here

window.PreosAnalytics = (function() {

  function trackPage(title, path) {
    if (typeof gtag !== 'function') return;
    gtag('event', 'page_view', {
      page_title: title || document.title,
      page_location: window.location.origin + (path || window.location.pathname)
    });
  }

  function trackPropertyView(property) {
    if (typeof gtag !== 'function') return;
    gtag('event', 'property_viewed', {
      property_id: property.id,
      property_title: property.title,
      property_price: property.price,
      property_city: property.city,
      property_type: property.type,
      has_3d_tour: property.has_3d_tour || false
    });
  }

  function trackSearch(query, resultsCount, filters) {
    if (typeof gtag !== 'function') return;
    gtag('event', 'search', {
      search_term: query,
      results_count: resultsCount,
      filter_type: (filters && filters.type) || 'all',
      filter_min_price: (filters && filters.minPrice) || 0,
      filter_max_price: (filters && filters.maxPrice) || 0,
      filter_bedrooms: (filters && filters.minBedrooms) || 0
    });
  }

  function trackTourBooked(property, date) {
    if (typeof gtag !== 'function') return;
    gtag('event', 'tour_booked', {
      property_id: property && property.id,
      property_city: property && property.city,
      property_price: property && property.price,
      booking_date: date
    });
    gtag('event', 'conversion', {
      event_category: 'engagement',
      event_label: 'tour_booking'
    });
  }

  function trackFavouriteAdded(property) {
    if (typeof gtag !== 'function') return;
    gtag('event', 'add_to_wishlist', {
      property_id: property && property.id,
      property_city: property && property.city,
      property_price: property && property.price
    });
  }

  function trackContactAgent(source, propertyId) {
    if (typeof gtag !== 'function') return;
    gtag('event', 'contact_agent', {
      source: source,
      property_id: propertyId
    });
  }

  function trackLanguageSwitch(lang) {
    if (typeof gtag !== 'function') return;
    gtag('event', 'language_switch', {
      language: lang
    });
  }

  function trackMapToggle(mode) {
    if (typeof gtag !== 'function') return;
    gtag('event', 'map_toggle', {
      mode: mode
    });
  }

  function trackFilterUsed(filterName, filterValue) {
    if (typeof gtag !== 'function') return;
    gtag('event', 'filter_used', {
      filter_name: filterName,
      filter_value: String(filterValue)
    });
  }

  function trackAuth(method, action) {
    if (typeof gtag !== 'function') return;
    gtag('event', action === 'signup' ? 'sign_up' : 'login', {
      method: method
    });
  }

  function track3DTour(propertyId) {
    if (typeof gtag !== 'function') return;
    gtag('event', '3d_tour_opened', {
      property_id: propertyId
    });
  }

  function trackScrollDepth(percent) {
    if (typeof gtag !== 'function') return;
    gtag('event', 'scroll', {
      percent_scrolled: percent
    });
  }

  return {
    trackPage,
    trackPropertyView,
    trackSearch,
    trackTourBooked,
    trackFavouriteAdded,
    trackContactAgent,
    trackLanguageSwitch,
    trackMapToggle,
    trackFilterUsed,
    trackAuth,
    track3DTour,
    trackScrollDepth
  };
})();
