/**
 * Country normalisation. Addresses store country as lowercase free text ("usa", "united states", "us"),
 * which splits counts in feasibility. This maps common spellings to ISO 3166-1 alpha-2 codes.
 * Anything not recognised returns null so it can be reviewed, never guessed.
 */
const ALIASES = {
    US: ["us", "usa", "u.s.", "u.s.a.", "united states", "united states of america", "america"],
    GB: ["gb", "uk", "u.k.", "united kingdom", "great britain", "england", "scotland", "wales", "northern ireland", "britain"],
    IN: ["in", "ind", "india", "bharat"],
    CA: ["ca", "can", "canada"],
    AU: ["au", "aus", "australia"],
    DE: ["de", "deu", "germany", "deutschland"],
    FR: ["fr", "fra", "france"],
    ES: ["es", "esp", "spain", "españa", "espana"],
    IT: ["it", "ita", "italy", "italia"],
    NL: ["nl", "nld", "netherlands", "holland", "the netherlands"],
    BR: ["br", "bra", "brazil", "brasil"],
    MX: ["mx", "mex", "mexico", "méxico"],
    JP: ["jp", "jpn", "japan"],
    CN: ["cn", "chn", "china", "prc"],
    SG: ["sg", "sgp", "singapore"],
    AE: ["ae", "are", "uae", "united arab emirates"],
    SA: ["sa", "sau", "saudi arabia", "ksa"],
    ZA: ["za", "zaf", "south africa"],
    IE: ["ie", "irl", "ireland"],
    NZ: ["nz", "nzl", "new zealand"],
    PH: ["ph", "phl", "philippines"],
    ID: ["id", "idn", "indonesia"],
    MY: ["my", "mys", "malaysia"],
    PK: ["pk", "pak", "pakistan"],
    BD: ["bd", "bgd", "bangladesh"],
    KR: ["kr", "kor", "south korea", "korea", "republic of korea"],
    SE: ["se", "swe", "sweden"],
    CH: ["ch", "che", "switzerland"],
    PL: ["pl", "pol", "poland"],
    BE: ["be", "bel", "belgium"],
    AR: ["ar", "arg", "argentina"],
    NG: ["ng", "nga", "nigeria"],
    EG: ["eg", "egy", "egypt"],
    TR: ["tr", "tur", "turkey", "türkiye", "turkiye"],
};
const LOOKUP = new Map();
for (const [code, names] of Object.entries(ALIASES)) for (const n of names) LOOKUP.set(n, code);

export function toCountryCode(value) {
    if (!value || typeof value !== "string") return null;
    const v = value.trim().toLowerCase().replace(/\s+/g, " ");
    return LOOKUP.get(v) ?? null;
}

export const COUNTRY_CODE = /^[A-Z]{2}$/;
