// Firestore-backed caches for the triangulation backfill.
//
// Without these, the cadastre 1.1 s throttle dominates wall time: ~5 calls
// per property × 8,452 properties × 1.1 s ≈ 13 hours just for cadastre.
// In practice the backfill has heavy duplication — many listings share the
// same Mapbox-area-centroid coord, the same city-centroid strikes, and the
// same nearby parcels. Caching by rounded coord and refcat collapses
// duplicate work to near-zero on warm runs.
//
// Three caches (each its own Firestore collection):
//   cadastre_coord_cache    key: "lat_lng" rounded to 4 decimals (~10 m)
//                           value: { parcels: [...] }
//   cadastre_parcel_cache   key: refcat (14-char)
//                           value: { details: {...} }
//   landmark_cache          key: normalized landmark name
//                           value: { lat, lng, place_name } | null (negative)
//
// Negative caching is supported — a landmark that Mapbox can't resolve is
// stored as `null` so we don't retry the lookup. Same for cadastre coords
// that return no parcels.
//
// All writes are best-effort fire-and-forget — a failed cache write doesn't
// fail the triangulation. Reads return null on any error so the caller
// falls back to the live API.

const COORD_PRECISION = 4; // ~11 m at this latitude

function coordKey(lat, lng) {
    return lat.toFixed(COORD_PRECISION) + '_' + lng.toFixed(COORD_PRECISION);
}

function normName(s) {
    if (!s) return '';
    return String(s).toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

class TriangulationCache {
    constructor(db, opts) {
        this.db = db;
        this.opts = opts || {};
        // In-memory mirror so multiple lookups within one invocation don't
        // double-hit Firestore.
        this._coordMem = new Map();
        this._parcelMem = new Map();
        this._landmarkMem = new Map();
        this._cityCentroidMem = new Map();

        this.stats = {
            coord_hit: 0, coord_miss: 0, coord_neg: 0,
            parcel_hit: 0, parcel_miss: 0, parcel_neg: 0,
            landmark_hit: 0, landmark_miss: 0, landmark_neg: 0,
            city_hit: 0, city_miss: 0
        };
    }

    // ── Coord (lookupByCoords) cache ─────────────────────────

    async getCoords(lat, lng) {
        const k = coordKey(lat, lng);
        if (this._coordMem.has(k)) {
            const v = this._coordMem.get(k);
            this.stats.coord_hit++;
            if (v && v.length === 0) this.stats.coord_neg++;
            return v;
        }
        try {
            const snap = await this.db.collection('cadastre_coord_cache').doc(k).get();
            if (snap.exists) {
                const v = (snap.data() && snap.data().parcels) || [];
                this._coordMem.set(k, v);
                this.stats.coord_hit++;
                if (v.length === 0) this.stats.coord_neg++;
                return v;
            }
        } catch (e) { /* fall through to miss */ }
        this.stats.coord_miss++;
        return null;
    }

    setCoords(lat, lng, parcels) {
        const k = coordKey(lat, lng);
        this._coordMem.set(k, parcels || []);
        // Fire-and-forget write.
        this.db.collection('cadastre_coord_cache').doc(k).set({
            parcels: parcels || [],
            cached_at: Date.now()
        }).catch(() => { /* best-effort */ });
    }

    // ── Parcel detail (lookupParcelDetails) cache ────────────

    async getParcel(refcat) {
        if (!refcat) return null;
        const k = refcat.slice(0, 14);
        if (this._parcelMem.has(k)) {
            const v = this._parcelMem.get(k);
            this.stats.parcel_hit++;
            if (v === null) this.stats.parcel_neg++;
            return v;
        }
        try {
            const snap = await this.db.collection('cadastre_parcel_cache').doc(k).get();
            if (snap.exists) {
                const v = (snap.data() && snap.data().details) || null;
                this._parcelMem.set(k, v);
                this.stats.parcel_hit++;
                if (v === null) this.stats.parcel_neg++;
                return v;
            }
        } catch (e) { /* fall through */ }
        this.stats.parcel_miss++;
        return undefined; // distinguishes "not in cache" from "cached as null"
    }

    setParcel(refcat, details) {
        if (!refcat) return;
        const k = refcat.slice(0, 14);
        this._parcelMem.set(k, details || null);
        this.db.collection('cadastre_parcel_cache').doc(k).set({
            details: details || null,
            cached_at: Date.now()
        }).catch(() => { /* best-effort */ });
    }

    // ── Landmark (Mapbox geocode) cache ──────────────────────

    async getLandmark(name) {
        const k = normName(name);
        if (!k) return null;
        if (this._landmarkMem.has(k)) {
            const v = this._landmarkMem.get(k);
            this.stats.landmark_hit++;
            if (v === null) this.stats.landmark_neg++;
            return v;
        }
        try {
            const snap = await this.db.collection('landmark_cache').doc(k).get();
            if (snap.exists) {
                const v = (snap.data() && snap.data().resolved) || null;
                this._landmarkMem.set(k, v);
                this.stats.landmark_hit++;
                if (v === null) this.stats.landmark_neg++;
                return v;
            }
        } catch (e) { /* fall through */ }
        this.stats.landmark_miss++;
        return undefined;
    }

    setLandmark(name, resolved) {
        const k = normName(name);
        if (!k) return;
        this._landmarkMem.set(k, resolved || null);
        this.db.collection('landmark_cache').doc(k).set({
            resolved: resolved || null,
            cached_at: Date.now()
        }).catch(() => { /* best-effort */ });
    }

    // ── City centroid cache (Mapbox strike 2/3 lookups) ──────
    // Same shape as landmark cache but stored in its own collection so we
    // can clear or audit independently.

    async getCityCentroid(searchText) {
        const k = normName(searchText);
        if (!k) return null;
        if (this._cityCentroidMem.has(k)) {
            this.stats.city_hit++;
            return this._cityCentroidMem.get(k);
        }
        try {
            const snap = await this.db.collection('city_centroid_cache').doc(k).get();
            if (snap.exists) {
                const v = (snap.data() && snap.data().resolved) || null;
                this._cityCentroidMem.set(k, v);
                this.stats.city_hit++;
                return v;
            }
        } catch (e) { /* fall through */ }
        this.stats.city_miss++;
        return undefined;
    }

    setCityCentroid(searchText, resolved) {
        const k = normName(searchText);
        if (!k) return;
        this._cityCentroidMem.set(k, resolved || null);
        this.db.collection('city_centroid_cache').doc(k).set({
            resolved: resolved || null,
            cached_at: Date.now()
        }).catch(() => { /* best-effort */ });
    }
}

module.exports = { TriangulationCache, coordKey, normName };
