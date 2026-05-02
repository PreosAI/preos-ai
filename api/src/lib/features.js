// Shared feature parsing for Resales PropertyFeatures tree.
//
// Resales returns features as a category tree:
//   PropertyFeatures.Category[] = [{ Type: "Pool", Value: ["Private", "Communal"] }, ...]
//
// The previous mapper flattened Type+Value into siblings, losing the parent context —
// so a filter like ?features=pool found nothing because the literal "pool" never
// appeared in the array. parseFeaturesTree() emits both the bare category slug and
// "${cat}_${val}" composites, plus a small alias table so conventional filter terms
// (sea_views, beachfront, terrace, elevator, air_conditioning) keep matching even
// though they don't follow the Resales tree structure.
//
// Used by resales-sync.js (writes), resales-property.js / resales-listings.js /
// resales-listings-paged.js (reads pass through unchanged).

function normalizeSlug(s) {
    if (s == null) return '';
    return String(s)
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9\s_]/g, ' ')
        .trim()
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

// Conventional filter terms users expect to work, mapped from the prefixed parse.
// Emitting both keeps frontend filters stable while the granular ${cat}_${val} path
// remains available for future granular filtering.
const FEATURE_ALIASES = {
    'views_sea': ['sea_views'],
    'setting_beachfront': ['beachfront'],
    'setting_beachside': ['beachfront'],
    'climate_control_air_conditioning': ['air_conditioning'],
    'climate_control_pre_installed_ac': ['air_conditioning'],
    'security_alarm_system': ['alarm_system'],
    'features_terrace': ['terrace'],
    'features_private_terrace': ['terrace'],
    'features_covered_terrace': ['terrace'],
    'features_lift': ['elevator'],
    'features_elevator': ['elevator'],
    'features_home_automation': ['home_automation'],
    'features_domotica': ['home_automation'],
    'pool_private': ['private_pool'],
    'pool_communal': ['communal_pool'],
    'garden_private': ['private_garden'],
    'garden_communal': ['communal_garden'],
};

function parseFeaturesTree(rawPropertyFeatures) {
    const out = new Set();
    if (!rawPropertyFeatures || !rawPropertyFeatures.Category) return [];
    const cats = Array.isArray(rawPropertyFeatures.Category)
        ? rawPropertyFeatures.Category
        : [rawPropertyFeatures.Category];
    for (const c of cats) {
        if (!c || !c.Type) continue;
        const catSlug = normalizeSlug(c.Type);
        if (!catSlug) continue;
        if (c.Value == null) continue;
        const values = Array.isArray(c.Value) ? c.Value : [c.Value];
        let pushedAny = false;
        for (const v of values) {
            const valSlug = normalizeSlug(v);
            if (!valSlug) continue;
            const composite = catSlug + '_' + valSlug;
            out.add(composite);
            const aliases = FEATURE_ALIASES[composite];
            if (aliases) for (const a of aliases) out.add(a);
            pushedAny = true;
        }
        if (pushedAny) out.add(catSlug);
    }
    return Array.from(out);
}

module.exports = { parseFeaturesTree, normalizeSlug, FEATURE_ALIASES };
