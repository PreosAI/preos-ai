// Phase A.5 Step 4 — one-shot demotion of non-residential exact-tier listings.
//
// Iterates listings where locationConfidence='exact', re-applies the
// type-eligibility check, demotes anything non-residential to 'medium', and
// records the demotion in location_reasoning.final_decision_reason. Reports
// counts and a per-type breakdown.
//
// Re-uses the SAME isExactEligibleType logic now in location-triangulation.js
// so the script and the live pipeline stay in lockstep. Run from api/.

const admin = require('firebase-admin');

// Inline duplicate of isExactEligibleType to avoid pulling the whole
// triangulation module's transitive deps. Keep keyword lists in sync with
// api/src/lib/location-triangulation.js.
const RESIDENTIAL = [
    'villa', 'chalet',
    'apartment', 'flat', 'apartamento',
    'townhouse', 'semi-detached', 'semidetached', 'adosado',
    'penthouse', 'atico', 'ático',
    'studio', 'estudio',
    'duplex', 'dúplex',
    'house', 'casa',
    'finca', 'cortijo'
];
const NON_RESIDENTIAL = [
    'storage', 'garage', 'parking', 'aparcamiento',
    'plot', 'land', 'solar', 'parcela',
    'cave',
    'commercial', 'comercial', 'local',
    'restaurant', 'restaurante',
    'shop', 'tienda',
    'office', 'oficina',
    'hotel', 'hostel',
    'bar',
    'apartment complex', 'building', 'edificio'
];

function isExactEligibleType(rawType, rawSubtype, normalizedType) {
    const text = ((rawType || '') + ' ' + (rawSubtype || '') + ' ' + (normalizedType || ''))
        .toLowerCase();
    if (!text.trim()) return false;
    for (const block of NON_RESIDENTIAL) if (text.includes(block)) return false;
    for (const allow of RESIDENTIAL) if (text.includes(allow)) return true;
    return false;
}

function normalizeType(type, sub) {
    const t = ((type || '') + ' ' + (sub || '')).toLowerCase();
    if (t.indexOf('apartment') > -1 || t.indexOf('flat') > -1 || t.indexOf('studio') > -1) return 'Apartamento';
    if (t.indexOf('villa') > -1 || t.indexOf('chalet') > -1 || t.indexOf('house') > -1 || t.indexOf('casa') > -1) return 'Villa';
    if (t.indexOf('townhouse') > -1 || t.indexOf('semi') > -1) return 'Adosado';
    if (t.indexOf('penthouse') > -1) return 'Ático';
    if (t.indexOf('plot') > -1 || t.indexOf('land') > -1) return 'Solar';
    if (t.indexOf('commercial') > -1) return 'Local';
    return type || 'Propiedad';
}

(async function main() {
    const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    if (!b64) { console.error('FIREBASE_SERVICE_ACCOUNT_BASE64 not set'); process.exit(1); }
    const sa = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
    const db = admin.firestore();

    const dryRun = process.argv.includes('--dry-run');
    console.log('Mode:', dryRun ? 'DRY RUN (no writes)' : 'WRITE');

    const snap = await db.collection('listings').where('locationConfidence', '==', 'exact').get();
    console.log('Inspecting', snap.size, 'exact-tier listings');

    const demotions = []; // { ref, propertyType, subtype, normalized }
    snap.forEach(doc => {
        const d = doc.data();
        const norm = normalizeType(d.propertyType, d.subtype);
        if (!isExactEligibleType(d.propertyType, d.subtype, norm)) {
            demotions.push({
                ref: doc.id,
                propertyType: d.propertyType,
                subtype: d.subtype,
                normalized: norm
            });
        }
    });

    console.log('\nDemotions needed:', demotions.length);
    const byType = {};
    for (const x of demotions) {
        const k = x.propertyType || '(empty)';
        byType[k] = (byType[k] || 0) + 1;
    }
    console.log('By raw propertyType:');
    for (const [t, n] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
        console.log('  ' + n.toString().padStart(4) + '  ' + t);
    }

    if (dryRun || demotions.length === 0) {
        process.exit(0);
    }

    // Recompute quality_score for medium tier:
    //   exact = 50 conf pts → medium = 25 conf pts
    //   loss of 25 pts. Apply directly so search ranking reflects the demotion.
    let updated = 0;
    for (const x of demotions) {
        const docRef = db.collection('listings').doc(x.ref);
        const docSnap = await docRef.get();
        if (!docSnap.exists) continue;
        const d = docSnap.data();
        const newReasoning = Object.assign({}, d.location_reasoning || {});
        const oldReason = newReasoning.final_decision_reason || '';
        newReasoning.final_decision_reason = (oldReason ? oldReason + ' · ' : '') +
            'phase-a.5 demotion: type_not_eligible_for_exact: ' + (x.propertyType || x.normalized || 'unknown');
        const oldScore = typeof d.quality_score === 'number' ? d.quality_score : 0;
        const newScore = Math.max(0, oldScore - 25); // exact 50 → medium 25 conf pts
        await docRef.set({
            locationConfidence: 'medium',
            location_reasoning: newReasoning,
            quality_score: newScore,
            previous_locationConfidence_before_a5: 'exact'
        }, { merge: true });
        updated++;
        if (updated % 5 === 0) process.stdout.write(' ' + updated);
    }
    console.log('\n\nDemoted:', updated, 'listings to medium tier.');
    process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
