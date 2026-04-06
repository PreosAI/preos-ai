/**
 * listing-quality.js — Phase 1: Client-side listing quality scoring
 *
 * Operates on the normalized Preos property object (same schema as
 * data/properties.json and the future MLS field mapper output).
 *
 * Scoring (100 pts total):
 *
 *  PHOTOS (60 pts)
 *    Count       : 0=0, 1=5, 2-4=15, 5-9=25, 10+=30
 *    Resolution  : all ≥1200px wide=20, all ≥800px=10, any <800px=0
 *    Orientation : all landscape=10, mixed=5, any portrait=0
 *
 *  METADATA (40 pts)
 *    Description : ≥200 chars=15, 50-199=8, <50=0
 *    Features    : ≥5=10, 3-4=5, <3=0
 *    Has 3D tour : yes=5
 *    GPS coords  : lat+lng present=5
 *    Year built  : present=5
 *    (energy_rating, size_m2, plot_m2 reserved for MLS — no points yet)
 *
 * Badge tiers:
 *   Premium    85-100  ⭐
 *   Completo   65-84   ✅
 *   Limitado   40-64   ⚠️
 *   Incompleto  0-39   ❌
 */

window.ListingQuality = (function () {

  var _cache = {};

  var TIERS = {
    premium:    { key: 'lqPremium',    color: '#065f46', bg: '#d1fae5', icon: '⭐' },
    completo:   { key: 'lqCompleto',   color: '#1e40af', bg: '#dbeafe', icon: '✅' },
    limitado:   { key: 'lqLimitado',   color: '#92400e', bg: '#fef3c7', icon: '⚠️' },
    incompleto: { key: 'lqIncompleto', color: '#991b1b', bg: '#fee2e2', icon: '❌' }
  };

  function tier(score) {
    if (score >= 85) return 'premium';
    if (score >= 65) return 'completo';
    if (score >= 40) return 'limitado';
    return 'incompleto';
  }

  function t(key) {
    return (window.PreosLang && PreosLang.t(key)) || key;
  }

  /* ── Image loader ───────────────────────────────────────── */

  function loadImg(url) {
    return new Promise(function (resolve) {
      var img = new Image();
      var done = false;
      var timeout = setTimeout(function () {
        if (!done) { done = true; resolve({ ok: false, w: 0, h: 0 }); }
      }, 8000);
      img.onload = function () {
        if (done) return; done = true; clearTimeout(timeout);
        resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight });
      };
      img.onerror = function () {
        if (done) return; done = true; clearTimeout(timeout);
        resolve({ ok: false, w: 0, h: 0 });
      };
      img.src = url;
    });
  }

  /* ── Main scorer ────────────────────────────────────────── */

  function analyze(property) {
    var id = property.id;
    if (_cache[id]) return Promise.resolve(_cache[id]);

    var urls = property.images || [];
    return Promise.all(urls.map(loadImg)).then(function (imgs) {
      var checks = [];
      var score = 0;

      /* — Photo count — */
      var loaded = imgs.filter(function (i) { return i.ok; }).length;
      var cPts = loaded >= 10 ? 30 : loaded >= 5 ? 25 : loaded >= 2 ? 15 : loaded === 1 ? 5 : 0;
      score += cPts;
      checks.push({
        id: 'img_count', labelKey: 'lqCheckImgCount',
        pass: loaded >= 5, warn: loaded >= 2 && loaded < 5,
        detail: loaded + ' ' + t('lqImages'), pts: cPts, max: 30
      });

      /* — Resolution — */
      var measured = imgs.filter(function (i) { return i.ok && i.w > 0; });
      var rPts = 0, rDetail = t('lqResNoImages');
      if (measured.length) {
        var allHD  = measured.every(function (i) { return i.w >= 1200; });
        var allOK  = measured.every(function (i) { return i.w >= 800; });
        rPts = allHD ? 20 : allOK ? 10 : 0;
        var minW = Math.min.apply(null, measured.map(function (i) { return i.w; }));
        rDetail = minW + 'px min';
      }
      score += rPts;
      checks.push({
        id: 'img_resolution', labelKey: 'lqCheckResolution',
        pass: rPts === 20, warn: rPts === 10,
        detail: rDetail, pts: rPts, max: 20
      });

      /* — Orientation — */
      var oPts = 0, oKey = 'lqResNoImages';
      if (measured.length) {
        var allLand = measured.every(function (i) { return i.w >= i.h; });
        var anyPort = measured.some(function (i) { return i.w < i.h; });
        oPts = allLand ? 10 : anyPort ? 0 : 5;
        oKey = allLand ? 'lqOrientAllLandscape' : anyPort ? 'lqOrientHasPortrait' : 'lqOrientMixed';
      }
      score += oPts;
      checks.push({
        id: 'img_orientation', labelKey: 'lqCheckOrientation',
        pass: oPts === 10, warn: oPts === 5,
        detail: t(oKey), pts: oPts, max: 10
      });

      /* — Description — */
      var descLen = ((property.description || '').trim()).length;
      var dPts = descLen >= 200 ? 15 : descLen >= 50 ? 8 : 0;
      score += dPts;
      checks.push({
        id: 'description', labelKey: 'lqCheckDescription',
        pass: dPts === 15, warn: dPts === 8,
        detail: descLen + ' chars', pts: dPts, max: 15
      });

      /* — Features — */
      var featCount = (property.features || []).length;
      var fPts = featCount >= 5 ? 10 : featCount >= 3 ? 5 : 0;
      score += fPts;
      checks.push({
        id: 'features', labelKey: 'lqCheckFeatures',
        pass: fPts === 10, warn: fPts === 5,
        detail: featCount + ' ' + t('lqFeatures'), pts: fPts, max: 10
      });

      /* — 3D tour — */
      var tourPts = property.has_3d_tour ? 5 : 0;
      score += tourPts;
      checks.push({
        id: 'tour_3d', labelKey: 'lqCheck3DTour',
        pass: !!property.has_3d_tour, warn: false,
        detail: property.has_3d_tour ? t('lqYes') : t('lqNo'),
        pts: tourPts, max: 5
      });

      /* — GPS coordinates — */
      var hasGPS = !!(property.lat && property.lng);
      var gpsPts = hasGPS ? 5 : 0;
      score += gpsPts;
      checks.push({
        id: 'location', labelKey: 'lqCheckLocation',
        pass: hasGPS, warn: false,
        detail: hasGPS
          ? (Number(property.lat).toFixed(4) + ', ' + Number(property.lng).toFixed(4))
          : t('lqMissing'),
        pts: gpsPts, max: 5
      });

      /* — Year built — */
      var hasYear = !!property.year_built;
      var yPts = hasYear ? 5 : 0;
      score += yPts;
      checks.push({
        id: 'year_built', labelKey: 'lqCheckYearBuilt',
        pass: hasYear, warn: false,
        detail: hasYear ? String(property.year_built) : t('lqMissing'),
        pts: yPts, max: 5
      });

      var tierKey = tier(score);
      var result = {
        propertyId: id, score: score,
        tier: tierKey, badge: TIERS[tierKey],
        checks: checks, analyzedAt: Date.now()
      };

      _cache[id] = result;
      return result;
    });
  }

  /* ── Rendering helpers ──────────────────────────────────── */

  function badgeHtml(result, compact) {
    var b = result.badge;
    var label = t(b.key);
    var style = 'display:inline-flex;align-items:center;gap:4px;' +
      'background:' + b.bg + ';color:' + b.color + ';' +
      'border-radius:4px;font-weight:700;white-space:nowrap;';
    if (compact) {
      return '<span style="' + style + 'font-size:11px;padding:2px 7px;">' +
        b.icon + ' ' + label + ' · ' + result.score + '/100</span>';
    }
    return '<div style="' + style + 'font-size:13px;padding:6px 12px;">' +
      b.icon + ' ' + label +
      ' <span style="opacity:.65;font-weight:500;">· ' + result.score + '/100</span></div>';
  }

  function checksHtml(result) {
    var rows = result.checks.map(function (c) {
      var icon = c.pass ? '✅' : c.warn ? '⚠️' : '❌';
      var ptsColor = c.pass ? '#065f46' : c.warn ? '#92400e' : '#991b1b';
      return '<div style="display:flex;justify-content:space-between;align-items:center;' +
        'padding:4px 0;border-bottom:1px solid #f3f4f6;font-size:12px;">' +
        '<span>' + icon + ' ' + t(c.labelKey) + '</span>' +
        '<span style="color:#6b7280;">' + c.detail +
        ' <span style="color:' + ptsColor + ';font-weight:600;">(' + c.pts + '/' + c.max + ')</span></span>' +
        '</div>';
    });
    return '<div style="margin-top:8px;">' + rows.join('') + '</div>';
  }

  /* ── Firestore cache (write only — read is future enrichment pipeline) ── */

  function saveToFirestore(result) {
    if (!window.firebase || !window.firebase.firestore) return;
    firebase.firestore()
      .collection('enrichment')
      .doc(result.propertyId)
      .set({
        qualityScore: result.score,
        qualityTier: result.tier,
        qualityChecks: result.checks.map(function (c) {
          return { id: c.id, pass: c.pass, warn: c.warn, pts: c.pts, max: c.max };
        }),
        qualityAnalyzedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true })
      .catch(function (e) { console.warn('LQ: Firestore write failed', e); });
  }

  /* ── Public API ─────────────────────────────────────────── */

  return {
    analyze: function (property) {
      return analyze(property).then(function (result) {
        saveToFirestore(result);
        return result;
      });
    },
    badgeHtml: badgeHtml,
    checksHtml: checksHtml,
    cache: _cache
  };

})();
