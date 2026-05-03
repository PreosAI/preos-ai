// City → expected municipality lookup for cadastre cross-validation.
//
// In our Resales dataset the `city` (Resales `Location`) field carries the
// granular locality / urbanization name, NOT the actual administrative
// municipality. Las Chapas / Marbesa / Sierra Blanca / Puerto Banús are all
// IN Marbella; Calahonda / La Cala de Mijas are IN Mijas; etc. The Spanish
// cadastre returns addresses with the municipality embedded ("CL FOO 1 29680
// MARBELLA (MÁLAGA)"), so we can cross-validate a candidate coord by
// checking whether the cadastre's municipality matches what we expect from
// the listing's `city`.
//
// Coverage target: the top ~60 city values in the data, which together
// account for >90% of listings. Any city not in the map falls through to
// using its own normalized form as the expected municipality (i.e. "if I
// don't know, assume Resales `city` is itself the municipality").
//
// Keys are normalized form (lowercased, diacritics stripped). Values are
// also normalized — match against the cadastre's address with the same
// normalization.

function normMuni(s) {
    if (!s) return '';
    return String(s)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const CITY_TO_MUNICIPALITY = {
    // Marbella urbanizations (eastern + central Marbella)
    'las chapas': 'marbella',
    'hacienda las chapas': 'marbella',
    'marbesa': 'marbella',
    'carib playa': 'marbella',
    'cabopino': 'marbella',
    'el rosario': 'marbella',
    'bahia de marbella': 'marbella',
    'los monteros': 'marbella',
    'rio real': 'marbella',
    'altos de los monteros': 'marbella',
    'elviria': 'marbella',
    // Marbella Golden Mile + west
    'sierra blanca': 'marbella',
    'nagueles': 'marbella',
    'golden mile': 'marbella',
    'the golden mile': 'marbella',
    'nueva andalucia': 'marbella',
    'aloha': 'marbella',
    'puerto banus': 'marbella',
    // San Pedro side (still Marbella municipality)
    'guadalmina alta': 'marbella',
    'guadalmina baja': 'marbella',
    'san pedro de alcantara': 'marbella',
    'marbella': 'marbella',

    // Mijas (Costa)
    'calahonda': 'mijas',
    'riviera del sol': 'mijas',
    'la cala de mijas': 'mijas',
    'la cala golf': 'mijas',
    'mijas costa': 'mijas',
    'mijas golf': 'mijas',
    'las lagunas': 'mijas',
    'mijas': 'mijas',

    // Estepona
    'el paraiso': 'estepona',
    'atalaya': 'estepona',
    'selwo': 'estepona',
    'cancelada': 'estepona',
    'new golden mile': 'estepona',
    'los flamingos': 'estepona',
    'estepona': 'estepona',

    // Fuengirola
    'higueron': 'fuengirola',
    'torreblanca': 'fuengirola',
    'los boliches': 'fuengirola',
    'fuengirola': 'fuengirola',

    // Benalmádena
    'benalmadena costa': 'benalmadena',
    'torrequebrada': 'benalmadena',
    'benalmadena': 'benalmadena',

    // Ojén
    'la mairena': 'ojen',
    'ojen': 'ojen',

    // Benahavís
    'la quinta': 'benahavis',
    'los arqueros': 'benahavis',
    'benahavis': 'benahavis',

    // Casares
    'dona julia': 'casares',
    'casares playa': 'casares',
    'casares': 'casares',

    // Manilva
    'la duquesa': 'manilva',
    'san luis de sabinillas': 'manilva',
    'sabinillas': 'manilva',
    'manilva': 'manilva',

    // Other towns from the top-60 (each is its own municipality)
    'malaga': 'malaga',
    'malaga centro': 'malaga',
    'torremolinos': 'torremolinos',
    'estacion de cartama': 'cartama',
    'cartama': 'cartama',
    'casarabonela': 'casarabonela',
    'coin': 'coin',
    'alhaurin el grande': 'alhaurin el grande',
    'alhaurin de la torre': 'alhaurin de la torre',
    'nerja': 'nerja',
    'velez malaga': 'velez malaga',
    'rincon de la victoria': 'rincon de la victoria',
    'alora': 'alora',
    'ronda': 'ronda',
    'monda': 'monda'
};

/**
 * Given a listing's `city` field, return the expected municipality (lowercased,
 * normalized). Falls back to the normalized city itself when the city is not
 * in the map — accepting "if I don't know, trust the listing".
 */
function getExpectedMunicipality(city) {
    if (!city) return '';
    const n = normMuni(city);
    if (CITY_TO_MUNICIPALITY[n]) return CITY_TO_MUNICIPALITY[n];
    return n;
}

/**
 * Strip the parenthesized province suffix from a cadastre address so we can
 * substring-match the municipality without false positives on the province name
 * (every Costa del Sol address ends with "(MÁLAGA)" — without this we'd match
 * `expectedMuni='malaga'` on every Marbella address too).
 */
function getCadastreMunicipality(addr) {
    if (!addr) return '';
    const stripped = addr.replace(/\s*\([^)]*\)\s*$/, '');
    return normMuni(stripped);
}

/**
 * True iff the cadastre address corresponds to the expected municipality.
 */
function municipalityMatches(cadastreAddr, expectedMuni) {
    if (!cadastreAddr || !expectedMuni) return false;
    const muni = normMuni(expectedMuni);
    const text = getCadastreMunicipality(cadastreAddr);
    if (!text) return false;
    // Whole-word containment so "ojen" doesn't match "rojen-something".
    const re = new RegExp('\\b' + muni.replace(/\s+/g, '\\s+') + '\\b');
    return re.test(text);
}

module.exports = {
    CITY_TO_MUNICIPALITY,
    getExpectedMunicipality,
    getCadastreMunicipality,
    municipalityMatches,
    normMuni
};
