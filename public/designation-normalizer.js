/*
 * Designation (role) name normalizer, shared by the browser and the server.
 * Merges case / spacing / punctuation variants and known spelling mistakes of the same
 * designation into one standard name (e.g. "PENTER", "panting" -> "Painter").
 *
 * To merge another spelling, add it to the matching list in DESIGNATION_ALIASES.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DesignationNormalizer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    // standard name -> spellings to merge into it (matching ignores case, spaces and punctuation)
    const DESIGNATION_ALIASES = {
        'Buffing': ['BUFFEING', 'BUFFIFNG', 'BUFFERING', 'BUFFFING', 'BUFFIFNG', 'BAFING', 'BAFFING', 'BAPPING', 'BOFING', 'BFUNING'],
        'Chipping': ['CHIPPER', 'CHIPING', 'CHIPPPING', 'CHIPIMG', 'CHHIPPING', 'CHIPPENG', 'CHPPER'],
        'Technician': ['TECNICIAN', 'TECHNICAN', 'TECHNECIAN', 'TECHNICION', 'TECHNICIN', 'TECHINICIAN', 'TECHINCIAN', 'TECHICIAN', 'TECHNICAIN', 'TECHENICAN', 'TECNITION', 'TENICIAN', 'TECHONICION', 'TECHNICTION', 'TECHONCION'],
        'Carpenter': ['CORPENTER', 'CARPAINTER', 'CARPENERT'],
        'Painter': ['PANTER', 'PINTER', 'PENTER', 'PENTAR', 'PENTING', 'PENTENG', 'PANTING', 'PANITER', 'PANITNG', 'PEINTER', 'PATINTER'],
        'Mason': ['MISTRI', 'MASSION', 'MASION', 'MESTRI', 'MESON', 'MATION', 'MOSSION', 'MEASON', 'MANSON'],
        'Rigger': ['RIGER', 'RIGGINGS'],
        'Khalasi': ['KALASI', 'KALASHI', 'KHALASHI', 'KALSHI', 'KALASI WORKER'],
        'Lift Operator': ['LIFT OPRATER', 'LIFT OPRETOR', 'LIFT OPRETER', 'LIFT OPTR', 'LIFT OPERATER', 'LIFT OPARATOR', 'LIF OPERATOR', 'LIFT OPSRSTOR', 'LIFT OP'],
        'Forklift Operator': ['FORK LIFT OPERATOR', 'FORKLIFT OPTR'],
        'Tower Crane Operator': ['TOWER CRAINE', 'TOWER CRAN OPERATOR', 'TOWER CRANE'],
        'JCB Operator': ['JCB OPT', 'JCB OPRETER', 'JCB OPREATOR'],
        'Crane Operator': ['CRANE OPRETOR'],
        'Tractor Driver': ['TRACTOR DRVIER', 'TRAILOR DRIVER'],
        'Plastering': ['PLASTING', 'PLUSTER', 'PLUSTER MISTRY', 'GYPSUM PLASTER'],
        'Shuttering': ['SHATTRING', 'SHATTERING', 'SHATTARING', 'SHETRING', 'SHUTTARING', 'SHUTTRING'],
        'False Ceiling': ['FALSE CELING', 'FALSE CEILLING', 'FALSE CEILING', 'FORE CELING', 'FALL CEELING', 'FAL CEELING', 'FALL CELING', 'FALSE CELIN'],
        'Landscaping': ['LAND SCAPPING', 'LAND SCAPING', 'LANDSCAPPING', 'LANDSKEPING', 'LANDSKEPING', 'LAND SCRPPING', 'LAND SCAPIING'],
        'Fabricator': ['FEBRICATER', 'FEBRICATOR', 'FEBRICATAR', 'FABRICUTTER'],
        'Electrician': ['ELECTRICION', 'ELECTRICAN', 'ELCTRICTION', 'ELACTRICION', 'ELECTRCIAN', 'ELECTRCIAN'],
        'Surveyor': ['SARVERYAR', 'SURVEY', 'SARVEYAR'],
        'Assistant Surveyor': ['ASST SURVEYOR', 'ASST. SURVEY', 'SERVEY ASSISTANT', 'SERVYE ASSISTANT'],
        'Foreman': ['FORMEN', 'FORE MAN', 'FOR MAN', 'FORMAIN', 'FORMAN', 'FOREFAN'],
        'Store Keeper': ['STORE KIPPER', 'STOR KEEPAR'],
        'Engineer': ['ENGENEER', 'ENGENEER', 'ENGENIEER', 'ENGNEER', 'ENGINNER', 'ENGINER', 'EINGEER', 'ENGINEER'],
        'Junior Engineer': ['JR ENGINEER', 'JR.ENGINEER', 'JR ENGENIR', 'JR ENGINNER', 'JUNIOR ENGG', 'JR ENGINEER'],
        'Safety Officer': ['SAFTEY OFFICER', 'SAFTY OFFCER', 'SEFTY ENGINEER'],
        'Waterproofing': ['WATER PROFING', 'WATER PROOF', 'WATERPROFFING'],
        'Core Cutting': ['CORE CUTING', 'COR CUTTING', 'CORECUTTING', 'CORCUTTING', 'CORECUTTING OPERATOR'],
        'Granite Work': ['GRENITE WORKS', 'GRENITE', 'GRANAITE', 'GRANITE WORKS', 'GERINAIT', 'GRANAITE'],

        // Standard names already used in the Manage > Designations dropdown (kept as-is)
        'Helper': [], 'Fitter': [], 'Welder': [], 'Plumber': [], 'Driver': [], 'Operator': ['OPARETOR', 'OPARETAR', 'OPERATER', 'OPRETER', 'APRETR'],
        'Safety': [], 'Security': [], 'NMR': [], 'HouseKeeping': ['HOUSE KEEPING'],
        'Casual Labor': ['CASUAL LABOUR'], 'Foreman/Supervisor': [], 'Rigger/Khalasi': []
        // Deliberately NOT merged (flagged for review in the source list):
        //   BUFFING & CHIPPING (combined role), CHIPPER/BUFFER (combined role), SEFETY ENGINEER
    };

    // Spelling / abbreviation variants reviewed across the whole designation list (merged).
    const DESIGNATION_EXTRA = {
        'Painter': ['PAINTING', 'PAINTAR', 'PAINTING WORK', 'PENTING WORK', 'PENTER WORK'],
        'Chipping': ['CHIPPING WORK', 'CHIPPING WORKS', 'CHIPING WORK'],
        'Buffing': ['BUFFER'],
        'Technician': ['TECAINES', 'ACE TECH', 'TECHNICAL', 'TECH', 'TEC', 'TECNICION', 'TECNICAN', 'TECHIAN', 'TECHNICINA', 'TECHNITION', 'TECHNISION', 'TCCHNICIAN', 'TECHANCION'],
        'Senior Technician': ['SR TECHNICIAN', 'SR.TECHNICIAN'],
        'AC Technician': ['AC TECHNICIAN', 'AC TECHNACIAN', 'A C TECH'],
        'Foreman': ['FOURMAN', 'FOUR MAN'],
        'Carpenter': ['CONCTOR', 'CARPANTER', 'CARPENTER8'],
        'Electrician': ['ELECTRICTION'],
        'Plumber': ['PLUMBING'],
        'Mason': ['MISSION', 'MISSON', 'MISION'],
        'Khalasi': ['KALASHI WORKER'],
        'Service Lift Operator': ['SERVICE LIFT OPERATOR', 'SERVICES LIFT OP', 'SERVICES LIFT OPRETER', 'SERVICESLIFT OPRETER'],
        'QS Billing': ['BILLING', 'QS', 'QS BILLING', 'BILLING ENGINEER'],
        'Lift Operator': ['LIFT OPT', 'LIFTING MACHINE OPERATOR', 'LMO OPERATOR'],
        'Tower Crane Operator': ['TC OPRETOR', 'T/C OPRETER', 'TC OPRETOIR', 'T C OPERATOR', 'T.C OPERATOR', 'TC OPERATOR'],
        'Signal Man': ['SIGNAL MAN', 'SIGNALMAN', 'SINGNAL MAN', 'SINGLE MAN', 'SINGNALMAN', 'SIGNALLMAN', 'SIGNL MAN', 'TC SIGNAL MAN', 'T C SIGNALMAN', 'T SIGNALMAN', 'TOWER SIGNAL MAN', 'TOWER SINGAL MAN'],
        'Assistant Surveyor': ['SURVEY ASSISTANT', 'SURVEYOR ASSITANT'],
        'Engineer': ['ENG', 'ENGINEERS', 'ENGINEERIMG'],
        'Junior Engineer': ['ENGINEER JR'],
        'Site Engineer': ['SITE ENGINEER', 'SITE ENGINEAR', 'SID ENGINNER', 'SITE ENGENEER', 'SITE ENGINNER', 'SITE ENGG'],
        'Senior Engineer': ['SENIOR ENGINEER', 'SR ENGINEER', 'SR.ENGINEER', 'SR. ENGINEER', 'SR.ENG', 'SENIOUR ENGINEER'],
        'Assistant Engineer': ['ASST ENGINEER', 'ASSISTANT ENGINEER'],
        'Service Engineer': ['SERVICE ENGERNEER'],
        'Project Engineer': ['PROJECT INGINEER'],
        'QC Engineer': ['QC ENGG', 'QC/ENGINEER'],
        'Design Engineer': ['DESIGEN ENGINEER'],
        'Supervisor': ['SUPERVIOR', 'SUPERVISIOR', 'SUPRVISOR', 'SUPERSVIOR', 'SUPERVISO', 'SUPREVISOR', 'SUPRVISR', 'SUPERIVOR', 'SUPER VAISOR'],
        'Contractor': ['CONTRACTAR', 'CONTACTOR', 'CONTACTER', 'CONTRATOR', 'CONTROCTER', 'CONTRECTOR', 'CONTCTOR', 'CONTRAOR', 'CONTOCTER'],
        'Sub Contractor': ['SUB CONTRACTOR', 'SUB-CONTRACTOR', 'SUB CONRACTOR'],
        'Thekedar': ['TAKEDHAR', 'THIKADAR'],
        'Hole Packing': ['HOLE PAKING', 'HOLEPACKING', 'HOLE PAEKING', 'HOL PACKING', 'HOL PAKING', 'GOL PACKING', 'HOLE PLAKING', 'HLE PACKING', 'HOLEPAKING', 'HOLLPACKING'],
        'Screed': ['SCEERD', 'SCEREED'],
        'Concrete': ['CONCRET', 'CONCREET', 'CONCRATE', 'CONCREATE', 'CONCREAT', 'COCREAT'],
        'Grinder': ['GLENDER', 'GRENDING', 'GLENDING'],
        'Barbender': ['BAR BINDER', 'BAR BENDER', 'ROD BENDER', 'STEEL BENDING', 'BARBELDING', 'BARBENDAR', 'BARBENDRA', 'BAR BENDOR', 'BAR BENDAR', 'BERBENDAR', 'BER BENDER', 'BARBENDING', 'BAR BENDING', 'BERBANDER', 'BARBEDER', 'BARBENDERT'],
        'Steel Fitter': ['STEEL FETTER'],
        'Steel Work': ['STEEL WORKS', 'STEEL WOEK'],
        'Fitter': ['FITER', 'FITEER'],
        'SPB Fitter': ['SBP FITTER', 'SBP FITER'],
        'HouseKeeping': ['HK', 'HOUSE KEPING'],
        'Helper': ['HELPAR', 'HEPLER'],
        'QC Helper': ['QC HALPER'],
        'Security': ['SECURITY GUARD', 'SECRITY'],
        'Lady Security Guard': ['LADY SECURITY', 'LADY SEC GUARD'],
        'Assistant Security Officer': ['ASS.SECURITY OFFICER', 'ASSTT. SECURITY OFFICER'],
        'Site Incharge': ['SIDE INCHARGE'],
        'Store Incharge': ['STORE IN CHARGE'],
        'Project Manager': ['PROJECT MANGER'],
        'Manager': ['MANEGER'],
        'Electrical Manager': ['ELECTRICAL MANGER'],
        'Marble Polish': ['MARBAL POLISH', 'MARBLE PALISH', 'MARBALPALISH', 'MARVAL PALIESH'],
        'Pump Operator': ['PUMP OP', 'PUMP OPRETOR'],
        'Bobcat Operator': ['BOBCAT OPT', 'BOBCOT OPERATER', 'BOB CUT OPREATOR', 'BOBCAT OPRETER'],
        'EOT Operator': ['EOT OPERATER'],
        'Scaffolder': ['SCARFOLDDING', 'SCOLLOLDER'],
        'Gardener': ['GARDENAR', 'GRADENER', 'GARADAN', 'GARDEN'],
        'Gas Cutter': ['GAS KATR'],
        'TM Driver': ['T.M. DRIVER', 'T.M DRIVER', 'T M DRIVER', 'TM DRIVCER'],
        'Ducting': ['DUCTING WORKS', 'AC DUCTING', 'AC DUCCHTING'],
        'Punning': ['PUNING', 'GYPSUM PINING', 'GYPSUM PUNINIG', 'GYPSUM PUNNING'],
        'Buffing & Chipping': ['CHIPPING & BUFFING', 'CHIPING & BUFFING'],
        'Safety Worker': ['SEFETY WORKER'],
        'False Ceiling': ['FALL CEELING WORK'],
        'Core Cutting': ['COUR CUTTING', 'CORE CUTIING', 'CORCATTING OPRETOR'],
        'Threading Operator': ['THREADING OPT'],
        'Net Worker': ['NET WORKERS']
    };
    // Confirmed by the business after review
    const DESIGNATION_CONFIRMED = {
        'Assistant Security Officer': ['ASO', 'A S O'],
        'Core Cutting': ['CUTTING', 'CUTTING OPT'],
        'Khalasi': ['KALASI (SAFETY)', 'KALASI( SAFETY)'],
        'Threading Operator': ['THREADING', 'THREADING WORK'],
        'Supervisor': ['SUP', 'SUPARISER', 'SUPERWER', 'SUPRVAEJR'],
        'Rigger': ['TRIGGER'],
        'Net Worker': ['NET FIXING', 'NET WORK'],
        'Mason': ['MISSION8142823461']
    };
    // Second batch confirmed by the business
    const DESIGNATION_CONFIRMED_2 = {
        'Assistant Surveyor': ['SST SURVEYOR'],
        'Contractor': ['ALL CONTCOTATOR'],
        'Welder': ['BELDER', 'WEEDER'],
        'Core Cutting': ['CORE MAN'],
        'Pump Operator': ['PUP OP'],
        'Bobcat Operator': ['BOBCAT'],
        'Threading Operator': ['TREADDING'],
        'Store Incharge': ['STORE IC'],
        'Project Manager': ['PM'],
        'Shuttering': ['CENTRING'],
        'Plastering': ['GYPSUM WORK'],
        'Buffing & Chipping': ['CHIPPER/BUFFER'],
        'Tractor Driver': ['TAILOR DRIVER'],
        'QC Engineer': ['QUALITY ENGINEER']
    };
    Object.keys(DESIGNATION_CONFIRMED_2).forEach(function (std) {
        DESIGNATION_CONFIRMED[std] = (DESIGNATION_CONFIRMED[std] || []).concat(DESIGNATION_CONFIRMED_2[std]);
    });
    Object.keys(DESIGNATION_CONFIRMED).forEach(function (std) {
        DESIGNATION_EXTRA[std] = (DESIGNATION_EXTRA[std] || []).concat(DESIGNATION_CONFIRMED[std]);
    });
    Object.keys(DESIGNATION_EXTRA).forEach(function (std) {
        DESIGNATION_ALIASES[std] = (DESIGNATION_ALIASES[std] || []).concat(DESIGNATION_EXTRA[std]);
    });

    // Possible matches that need a human decision. NOT applied by normalizeDesignation();
    // they only appear in the review report (scripts/designation-report.js).
    const DESIGNATION_REVIEW = {};

    const KEEP_UPPER_NO_VOWEL = /^[^AEIOUY]{1,5}$/; // TM, NMR, HK, VDF, UPBC ... stay upper-case

    function keyOf(s) {
        return String(s == null ? '' : s).toUpperCase().replace(/[&$]/g, ' AND ').replace(/[^A-Z0-9]+/g, '');
    }

    const KEY_TO_STANDARD = new Map();
    Object.keys(DESIGNATION_ALIASES).forEach(function (std) {
        KEY_TO_STANDARD.set(keyOf(std), std);
        DESIGNATION_ALIASES[std].forEach(function (a) { KEY_TO_STANDARD.set(keyOf(a), std); });
    });

    // "SITE ENGINEER" / "site engineer" -> "Site Engineer"; "TM DRIVER" -> "TM Driver"
    function tidyCase(raw) {
        return raw.split(/([\s\/\-&.]+)/).map(function (part) {
            if (!part || /^[\s\/\-&.]+$/.test(part)) return part;
            const up = part.toUpperCase();
            if (/^[A-Z]+$/.test(up) && KEEP_UPPER_NO_VOWEL.test(up)) return up;
            return up.charAt(0) + up.slice(1).toLowerCase();
        }).join('');
    }

    function normalizeDesignation(name) {
        const raw = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
        if (!raw) return '';
        if (/^others?$/i.test(raw)) return 'Others';
        const hit = KEY_TO_STANDARD.get(keyOf(raw));
        if (hit) return hit;
        return tidyCase(raw);
    }

    // Normalize a list, dropping duplicates but keeping first-seen order; "Others" goes last.
    function normalizeList(list) {
        const seen = new Set();
        const out = [];
        let hasOthers = false;
        (Array.isArray(list) ? list : []).forEach(function (n) {
            const c = normalizeDesignation(n);
            if (!c) return;
            if (c === 'Others') { hasOthers = true; return; }
            if (!seen.has(c)) { seen.add(c); out.push(c); }
        });
        if (hasOthers) out.push('Others');
        return out;
    }

    return { normalizeDesignation, normalizeList, DESIGNATION_ALIASES, DESIGNATION_REVIEW, keyOf: keyOf };
});
