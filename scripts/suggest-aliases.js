// Lists contractor names that are NOT merged yet but look like a typo of a known contractor,
// so they can be reviewed and added to the alias list explicitly.
require('dotenv').config();
const mongoose = require('mongoose');
const N = require('../public/contractor-normalizer.js');
const key = (x) => String(x || '').toUpperCase().replace(/[&$]/g, 'AND').replace(/[^A-Z0-9]/g, '');
function dist(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
        prev = cur;
    }
    return prev[b.length];
}
(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const g = await mongoose.connection.db.collection('employees').aggregate([{ $group: { _id: '$contractor', c: { $sum: 1 } } }]).toArray();
    const m = {};
    g.forEach(x => { const k = N.normalizeContractor(x._id); m[k] = (m[k] || 0) + x.c; });
    const names = Object.keys(m).filter(n => n && n !== 'Others');
    const known = new Set(Object.keys(N.CONTRACTOR_ALIASES).concat(['KLC', 'BSR']));
    const out = [];
    for (const n of names) {
        if (known.has(n)) continue;
        const k = key(n);
        for (const c of known) {
            const kc = key(c);
            if (k.length < 6 || kc.length < 6) continue;
            const d = dist(k, kc, k.length >= 12 ? 2 : 1);
            if (d <= (k.length >= 12 ? 2 : 1)) { out.push(`${m[n]}\t${n}  ~  ${c}   (${m[c] || 0})`); break; }
        }
    }
    console.log(out.sort((a, b) => parseInt(b) - parseInt(a)).join('\n'));
    await mongoose.disconnect();
})();
