# Open Issues

Tracked issues that surfaced during development but are not blocking the
current phase. Each entry: short description, where it was discovered, and
proposed fix scope. Closed issues should be deleted, not struck through.

---

## PropertyType normalization gap for commercial categories

**Discovered:** Phase A pre-work probe of Resales V6 raw fields for R134059
(Estepona). Resales returned `PropertyType.NameType="Shop"`, `Type="Commercial"`,
`Subtype1="Shop"`, `Subtype2="Restaurant"` — but `mapToFrontend.normalizeType`
in `api/src/lib/listings-query.js` doesn't have a branch for "Shop", so it
falls through and returns the raw `propertyType` string. The downstream
listings response then surfaces a non-standard `type` value that the frontend
filter chips ignore.

**Symptom:** R134059 was picked by the cadastre smoke test as a "Villa"
because some upstream sync had written a normalized type that no longer
matches what the current normalizer produces. The doc-vs-code drift means
property type rendering is inconsistent for commercial listings.

**Scope to fix:** Add explicit branches in `normalizeType` for `shop`,
`restaurant`, `office`, `bar`, etc. — likely all map to `Local` (the existing
"Local" bucket) or a new `Comercial` bucket. Verify which downstream filter
strings the frontend expects before naming the bucket. Also check
`api/src/functions/resales-property.js` and `api/src/functions/resales-listings.js`
for parallel normalizer copies.

**Why deferred:** Doesn't block triangulation. Affects rendering of a small
subset of commercial-category listings; users can still find them via
free-text search.

**Owner / Phase:** Phase B clean-up.
