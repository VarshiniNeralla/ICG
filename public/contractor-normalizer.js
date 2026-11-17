/*
 * Contractor name normalizer, shared by the browser and the server.
 * Collapses spelling / case / punctuation variants of the same contractor into one
 * canonical name (e.g. "klc- uttam kumar", "KLC / SARVAN SAHANI" -> "KLC").
 *
 * To merge another contractor, add it to CONTRACTOR_ALIASES below.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ContractorNormalizer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    // canonical name -> known variants (matching ignores case, spaces and punctuation)
    const CONTRACTOR_ALIASES = {
        'OTIS': [],
        'PEKETI': [],
        'AJAY SHARMA': [],
        'MALLICK & CO': ['MALLICK CO', 'MALLICK&CO', 'MALLICK $ CO', 'MALLICK.CO', 'MALLICK AND CO'],
        'LOTUS LEAF': ['LOTOUS LEAF'],
        'APARNA': [],
        'SRI LAXMI': [],
        'L T RAO': ['LT RAO'],
        'R K MEENA': ['RK MEENA', 'R.K MEENA'],
        'MADHAVI INFRA': ['MADAVI INFRA'],
        'V K B S': ['V.K.B.S', 'VK BS', 'VKBS'],
        'FS ART': ['F.S ART', 'F K ART', 'F.K ART'],
        'S.V. HOSPITALITY SERVICES': ['S.V HOSPITALITY SERVICES', 'S V HOSPITALITY SERVICES'],
        'CRETIO INTERIOR': ['CRETIO'],
        'PRADHAN': [],
        'SBK': [],
        'K.V. ENTERPRISES': ['K.V.ENTERPRISES', 'KV ENTERPRISES'],
        'KAILASH': [],
        'SIEMENS': ['SIMENS'],
        'SCHWING STETTER': ['SCHWING STETTAR', 'SCWHING STETTER', 'SHWING STTATER', 'SCHWING STETTER INDIA'],
        'SAMEER CONSTRUCTIONS': ['SAMEER', 'SAMEER CONSTRUCTION', 'SAMEER CONTRUCTIONS'],
        'NEW ROSE': [],
        'TRIPURA PROJECTS': [],
        'NAVNI': [],
        'LIMRA': [],
        'ACO WALLS': [],
        'O & S': ['O&S', 'O $ S'],
        'SS ENTERPRISES': [],
        'K C K CREATIONS': ['C K CREATIONS', 'C.K CREATIONS'],
        'VS INTERIORS': ['VS INTRIORS', 'VS INTERIOR', 'V S INTERIORS', 'V.S INTERIORS'],
        'ALIA ENTERPRISES': ['ALIA ENTERPRISE', 'ALIA ENTRPRISES', 'ALIA ENTERPEISE'],
        'SHESHA INFRA': ['SHESHA INFRA CON', 'SHESHA INFRA TECH', 'SHESHA INFRACON', 'SHSHA INFRA TECH'],
        'DELTA SERVICES': ['DELTA SERVICE', 'DELTA SERVIES'],
        'DRS': ['D S R', 'D R S', 'DRS ENTERPRISES'],
        'REHAN AKHTER': ['REHAN AKTHAR', 'REHAN AKHTAR', 'REHAN AKTAR'],
        'TEJA POWER': ['TEJHA POWER', 'TEJAPAWAR'],
        'LIMRA WATERPROOFING': ['LIMRA WATER PROOFING', 'LIMRA W/P', 'LIMRA WATER PROFING'],
        'SHIVA PARVATHI TILES': ['SHIVA PARVATI TILES', 'SIVA PARVATHI TILES'],
        'GLOZO INDIA': ['GLOZO INDIA PVT LTD', 'GLOZO INDIA PVT'],
        'JAHNAVI ENGINEERING': ['JAHNAVI ENG AND SERVICES', 'JAHNAVI ENG SERVICE', 'JAHANVI ENGINEERING'],
        'PRUDHVI MEP': ['PRUDHVI MEP PROJECTS', 'PRUDHVI MEP PROJECT'],
        'SREE SAI MAHALAXMI': ['SRI SAI MAHALAXMI', 'SREE SAI MAHA LAXMI'],
        'VISHWAKARMA': ['VISHWAKARAMA', 'VISWAKHARMA'],
        'JABBAR': ['JABBAR CONSTRUCTION', 'JABBAR CONSTRUCTIONS'],
        'VAISHNAVI INTERIORS': ['VAISHNAVI INTERIOR'],
        'FIRE COOL': ['FIRE & COOL'],
        'BSR': [],
        'RANGOLI MARKETING': ['RANGOLI MARKETING COMPANY'],
        'MY HOME PRECAST': ['MY HOME-PRECAST', 'MY HOME PRECAST PLANT'],
        'BLUE FIRE': ['BLUE FIRE CREATIONS', 'BLUE FIRE CREATION'],
        'ASG INFRA': ['ASG INFRA SOLUTIONS', 'ASG INFRA SOLUTION'],
        'THAKUR PLUMBING': ['THAKUR PLUMBING WORKS', 'THAKUR PULMBING'],
        'EKAIVA': ['EKAIVA PROJECT', 'EKAIVA PROJECTS'],
        'PAL STRUCTURALS': ['PAL STRUCTURES', 'PAL STRUCTURAL'],
        'KIRAT': ['KIRAT CONSTRUCTION', 'KEERATH CONSTRUCTION'],
        'SRI VELMURUGAN': ['SRI VELMURGAN', 'VELMURUGAN', 'SRI VELU MURGAN'],
        'CHOTELAL': ['CHOTE LAL', 'CHOTELAL SINGH'],
        'M G FABRICATOR': ['MG FABRICATOR'],
        'SIDDHARTH ELECTRICAL': ['SIDDHARTH ELECTRICALS', 'SIDDHARTH ELE', 'SIDHHART ELECTRICALS'],
        'YALAVARTI': ['YALAVARTHI', 'YALLAVARTI'],
        'PRADHA ENGINEERING': ['PRADHA ENGINEERING SERVICE', 'PRADHA ENGINEER'],
        'KRUPA CIVIL': ['KRUPA CIVIL WORKS', 'KRUPA CIVIL WORK'],
        'LOTUS LEAF WATERPROOFING': ['LOTUS LEAF WATER PROFING']
        // Deliberately NOT merged (flagged "verify" in the source list):
        //   DEVI / DHS / DEEPAK HOSPITALITY SERVICES, SRI REKHA INTERIORS / FURNITURE
    };

    // Spelling mistakes seen in real data, reviewed one by one (added via scripts/suggest-aliases.js).
    // Short look-alike names (AK / OM / SV ENTERPRISES ...) are different companies and are NOT here.
    const CONTRACTOR_TYPOS = {
        'SCHWING STETTER': [
            'SCHWING SETTER',
            'SCHIWING STETTER',
            'SEHWING SETTER',
            'SHWING STETTER',
            'SCHWING STTETER'
        ],
        'VISHWAKARMA': [
            'VISHAWAKARMA',
            'VISWAKARMA',
            'VISHWAKRMA',
            'VISHWKARMA'
        ],
        'REHAN AKHTER': [
            'REHAN AKTER'
        ],
        'ALIA ENTERPRISES': [
            'ALIA ENTERPRIESES',
            'ALAI ENTERPRISES',
            'ALIA ENRTERPRISES',
            'ALIA ENTERPRIESE',
            'AALIA ENTERPRISES',
            'ALIA ENTERPRIES',
            'ALIA ENTERRPISES'
        ],
        'PRADHAN': [
            'PRADAN'
        ],
        'S.V. HOSPITALITY SERVICES': [
            'S.V HOSPITALITY SERVICE',
            'SV HOSPITALITY SERVISES',
            'SV HOSPITALTY SERVICE',
            'SV HOSPITALITY SERVICE'
        ],
        'AJAY SHARMA': [
            'AJAY SHARAMA',
            'AJAY SARMA',
            'AJYAY SHARMA',
            'AJAYA SHARMA'
        ],
        'VS INTERIORS': [
            'VS INTERIOURS',
            'VS INTIRIORS',
            'V S INTERIOS',
            'VS INTERIOS',
            'V S INTERORS',
            'VS INRERIORS',
            'VS INTERIOUS'
        ],
        'RANGOLI MARKETING': [
            'RONGOLI MARKETING',
            'RANGOLI MARKRTING'
        ],
        'SHIVA PARVATHI TILES': [
            'SHIVA PARAVATHI TILES',
            'SHIVA PARVATHI TILESH',
            'SHIVA PARBATI TILES',
            'SHIVA PARVATHI TILS',
            'SHIVA PARAVARHI TILES',
            'SHIVA PRAVATHI TILES'
        ],
        'ACO WALLS': [
            'ACOWALL',
            'ACOWALLS'
        ],
        'THAKUR PLUMBING': [
            'THAKUR PIUMBING',
            'THAKUR PLUBING',
            'THAKUR PLUMBIG',
            'THUKUR PLIMBING',
            'THAKUR PLUMBINGS',
            'THAKUR PLUMBNG'
        ],
        'MALLICK & CO': [
            'MALLIK $ CO',
            'MALLIK & CO',
            'MALLICA $ CO',
            'MALLICI.&.CO'
        ],
        'PAL STRUCTURALS': [
            'PAL STRUCTURELS',
            'PAL STRUTURALS'
        ],
        'JAHNAVI ENGINEERING': [
            'JAHNAVI ENGNEERING',
            'JAHANAVI ENGINEERINGS',
            'JAHNAVI ENGIEERING',
            'JHANAVI ENGINEERING'
        ],
        'SIDDHARTH ELECTRICAL': [
            'SIDHHART ELECTRICAL',
            'SIDDHART ELECTRICAL',
            'SIDDHARTHE LECTRICIAN',
            'SIDARTH ELECTRICAL',
            'SIDDHARATH ELECTRICAL'
        ],
        'TRIPURA PROJECTS': [
            'TRIPURA PROJECT',
            'TRIPURA PROJETCS',
            'TRIPURA PROJETS'
        ],
        'SHESHA INFRA': [
            'SESHA INFRA',
            'SHESA INFRA',
            'SHESH INFRA'
        ],
        'SRI VELMURUGAN': [
            'SRI VELMURAGAN',
            'SRI VELMURGUN'
        ],
        'SRI LAXMI': [
            'SR LAXMI',
            'SRI LAXAMI'
        ],
        'DELTA SERVICES': [
            'DELTA BERVICES',
            'DELTA SARVICES',
            'DELTA SERVISE'
        ],
        'M G FABRICATOR': [
            'M G FABRICATION'
        ],
        'MY HOME PRECAST': [
            'MY HOME ORECAST',
            'MY HOME PRECASY',
            'MY HOME PRECST',
            'MY HOME PRECASTN',
            'MY HOME PREECAST'
        ],
        'SAMEER CONSTRUCTIONS': [
            'SAMEERV CONTRUCTIONS',
            'MAMEER CONSTRUCTION',
            'SAMEER CONSTRACTION'
        ],
        'MADHAVI INFRA': [
            'MADHVI INFRA',
            'MADHAVI INRFA'
        ],
        'SS ENTERPRISES': [
            'SS ENTERPRICES',
            'SS ENTERPRICE',
            'S S ENTARPRISES',
            'SS ENTARPRISES'
        ],
        'K.V. ENTERPRISES': [
            'K.V. INTERPRISES'
        ],
        'VAISHNAVI INTERIORS': [
            'VAISHANAVI INTERIOR'
        ],
        'SIEMENS': [
            'SEMENS',
            'SIEMANS'
        ],
        'PRADHA ENGINEERING': [
            'PRADHA ENGENEERING',
            'PRADHA ENGINGEERING'
        ],
        'TEJA POWER': [
            'TEJAPOWAR'
        ],
        'BLUE FIRE': [
            'BIUE FIRE'
        ],
        'LIMRA WATERPROOFING': [
            'LIMBRA WATER PROOFING'
        ],
        'CHOTELAL': [
            'CHHOTELAL'
        ],
        'R K MEENA': [
            'RK MEENAR'
        ],
        'LOTUS LEAF': [
            'LOTUS LEAAF'
        ],
        'YALAVARTI': [
            'YALAVRTI'
        ],
        'SREE SAI MAHALAXMI': [
            'SREE SAI MHA LAXMI'
        ],
        'APARNA': [
            'APARANA'
        ]
    };
    Object.keys(CONTRACTOR_TYPOS).forEach(function (c) {
        CONTRACTOR_ALIASES[c] = (CONTRACTOR_ALIASES[c] || []).concat(CONTRACTOR_TYPOS[c]);
    });

    // Any contractor starting with one of these prefixes collapses to the canonical name.
    // e.g. "KLC - SAHIDUL ISLAM", "KLC/ UTTAM KUMAR", "KLC PVT LTD" -> "KLC"
    const CONTRACTOR_PREFIX_RULES = [
        { prefix: 'KLC', canonical: 'KLC' }
    ];

    // Name merely CONTAINING the token (as a separate word) also collapses,
    // e.g. "BSR INFRA", "B S R", "SARAS BSR", "BSR (SARAS)", "JAYANTI BARMAN (KLC)".
    const CONTRACTOR_CONTAINS_RULES = [
        { re: /(^|[^A-Z0-9])B.?s?S.?s?R(?![A-Z0-9])/, canonical: 'BSR' },
        { re: /(^|[^A-Z0-9])KLC(?![A-Z0-9])/, canonical: 'KLC' }
    ];

    // Lowercase-insensitive key: uppercase, & / $ read as AND, drop everything non-alphanumeric.
    function keyOf(s) {
        return String(s == null ? '' : s)
            .toUpperCase()
            .replace(/[&$]/g, ' AND ')
            .replace(/[^A-Z0-9]+/g, '');
    }

    const KEY_TO_CANONICAL = new Map();
    Object.keys(CONTRACTOR_ALIASES).forEach(function (canon) {
        KEY_TO_CANONICAL.set(keyOf(canon), canon);
        CONTRACTOR_ALIASES[canon].forEach(function (a) { KEY_TO_CANONICAL.set(keyOf(a), canon); });
    });

    // Token helpers: "S.V. HOSPITALITY" -> ["S","V","HOSPITALITY"]; & and $ read as AND.
    function tokensOf(s) {
        return String(s == null ? '' : s).toUpperCase().replace(/[&$]/g, ' AND ').split(/[^A-Z0-9]+/).filter(Boolean);
    }

    // Known names (canonical + aliases) as token lists, longest first, so "LIMRA WATERPROOFING X"
    // goes to LIMRA WATERPROOFING and not to LIMRA.
    const PREFIX_INDEX = [];
    Object.keys(CONTRACTOR_ALIASES).forEach(function (canon) {
        [canon].concat(CONTRACTOR_ALIASES[canon]).forEach(function (n) {
            const t = tokensOf(n);
            if (!t.length || (t.length === 1 && t[0].length < 3)) return;
            PREFIX_INDEX.push({ tokens: t, canon: canon });
        });
    });
    PREFIX_INDEX.sort(function (x, y) { return y.tokens.length - x.tokens.length; });

    function startsWithKnownName(name) {
        const t = tokensOf(name);
        for (const e of PREFIX_INDEX) {
            if (e.tokens.length > t.length) continue;
            let ok = true;
            for (let i = 0; i < e.tokens.length; i++) if (e.tokens[i] !== t[i]) { ok = false; break; }
            if (ok) return e.canon;
        }
        return null;
    }

    function prefixRule(raw) {
        const up = String(raw).toUpperCase().trim();
        for (const r of CONTRACTOR_PREFIX_RULES) {
            // prefix followed by end or a non-letter/digit separator (so "KLCX" isn't swallowed)
            if (up === r.prefix || new RegExp('^' + r.prefix + '(?![A-Z0-9])').test(up)) return r;
        }
        return null;
    }

    function normalizeContractor(name) {
        const raw = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
        if (!raw) return '';
        if (/^others?$/i.test(raw)) return 'Others';
        const rule = prefixRule(raw);
        if (rule) return rule.canonical;
        const up = raw.toUpperCase();
        for (const r of CONTRACTOR_CONTAINS_RULES) if (r.re.test(up)) return r.canonical;
        const key = keyOf(raw);
        const hit = KEY_TO_CANONICAL.get(key);
        if (hit) return hit;
        const pre = startsWithKnownName(raw);
        if (pre) return pre;
        return raw.toUpperCase(); // unknown: at least make case variants identical
    }

    // For "KLC - UTTAM KUMAR" returns "UTTAM KUMAR" (used to keep the person as Thekedar); else ''.
    function extractSubName(name) {
        const raw = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
        const rule = raw && prefixRule(raw);
        if (!rule) return '';
        const rest = raw.slice(rule.prefix.length).replace(/^[\s\-–—\/:.,]+/, '').trim();
        if (/^(PVT\.?\s*LTD\.?|PRIVATE LIMITED|LTD\.?)$/i.test(rest)) return '';
        return rest.toUpperCase();
    }

    // Normalize a list, dropping duplicates but keeping first-seen order; "Others" goes last.
    function normalizeList(list) {
        const seen = new Set();
        const out = [];
        let hasOthers = false;
        (Array.isArray(list) ? list : []).forEach(function (n) {
            const c = normalizeContractor(n);
            if (!c) return;
            if (c === 'Others') { hasOthers = true; return; }
            if (!seen.has(c)) { seen.add(c); out.push(c); }
        });
        if (hasOthers) out.push('Others');
        return out;
    }

    return { normalizeContractor, extractSubName, normalizeList, CONTRACTOR_ALIASES };
});
