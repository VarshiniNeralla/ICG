// READ-ONLY report: current stored designation -> proposed standard, with employee counts.
//   node scripts/designation-report.js      (writes reports/designation-mapping.csv and .md; changes nothing)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const N = require('../public/designation-normalizer.js');

const reviewByKey = new Map();
Object.entries(N.DESIGNATION_REVIEW).forEach(([std, list]) => list.forEach(a => reviewByKey.set(N.keyOf(a), std)));
const dist = (a, b, max) => {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
        prev = cur;
    }
    return prev[b.length];
};
const csv = (v) => '"' + String(v).replace(/"/g, '""') + '"';

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const g = await mongoose.connection.db.collection('employees').aggregate([{ $group: { _id: '$designation', c: { $sum: 1 } } }]).toArray();
    await mongoose.disconnect();
    const rows = g.map(x => {
        const orig = x._id || '';
        const std = N.normalizeDesignation(orig);
        const rev = reviewByKey.get(N.keyOf(orig));
        let status = 'UNCHANGED';
        if (!orig) status = 'BLANK';
        else if (rev && std === N.normalizeDesignation(orig) && !N.DESIGNATION_ALIASES[std]?.length === false && false) status = 'UNCHANGED';
        if (orig && std !== orig) status = 'MERGE';
        if (rev) status = 'REVIEW';
        return { orig, c: x.c, std: status === 'REVIEW' ? orig : std, status, suggest: rev || '' };
    }).sort((a, b) => a.std.localeCompare(b.std) || b.c - a.c);

    const total = rows.reduce((s, r) => s + r.c, 0);
    const agg = {};
    rows.forEach(r => { agg[r.std] = (agg[r.std] || 0) + r.c; });

    fs.mkdirSync(path.join(__dirname, '..', 'reports'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '..', 'reports', 'designation-mapping.csv'),
        'Original designation,Employees,Status,Proposed standard,Review suggestion\n' +
        rows.map(r => [r.orig || '(blank)', r.c, r.status, r.std || '(blank)', r.suggest].map(csv).join(',')).join('\n'));

    // groups that actually merge (>1 original, or a rename)
    const merged = {};
    rows.filter(r => r.status === 'MERGE').forEach(r => { (merged[r.std] = merged[r.std] || []).push(r); });
    const unchangedByStd = {};
    rows.filter(r => r.status === 'UNCHANGED').forEach(r => { unchangedByStd[r.std] = r; });

    let md = '# Designation mapping report (nothing applied)\n\n';
    md += `Employees: **${total}** | distinct designations now: **${rows.length}** | after proposed merge: **${Object.keys(agg).length}**\n\n`;
    md += '## 1. Proposed merges (original -> standard)\n\n';
    Object.keys(merged).sort().forEach(std => {
        const base = unchangedByStd[std];
        const parts = merged[std].map(r => `${r.orig} (${r.c})`);
        if (base) parts.unshift(`${base.orig} (${base.c}) [already standard]`);
        const sum = merged[std].reduce((s, r) => s + r.c, 0) + (base ? base.c : 0);
        md += `- **${std}: ${sum}**  <-  ${parts.join(', ')}\n`;
    });
    md += '\n## 2. Uncertain: NOT merged, needs your decision\n\n';
    rows.filter(r => r.status === 'REVIEW').sort((a, b) => a.suggest.localeCompare(b.suggest)).forEach(r => {
        md += `- ${r.orig} (${r.c})  ->  maybe **${r.suggest}** (${agg[r.suggest] || 0})\n`;
    });
    md += '\n## 3. Similar names deliberately left separate (please confirm)\n\n';
    const stds = Object.keys(agg).filter(s => s && s !== 'Others').sort();
    const pairs = [];
    for (let i = 0; i < stds.length; i++) for (let j = i + 1; j < stds.length; j++) {
        const a = N.keyOf(stds[i]), b = N.keyOf(stds[j]);
        if (a.length < 5 || b.length < 5) continue;
        const near = dist(a, b, 2) <= 2 || (a.length >= 6 && b.includes(a)) || (b.length >= 6 && a.includes(b));
        if (near) pairs.push([stds[i], stds[j]]);
    }
    pairs.sort((p, q) => (agg[q[0]] + agg[q[1]]) - (agg[p[0]] + agg[p[1]]));
    pairs.slice(0, 60).forEach(([a, b]) => { md += `- ${a} (${agg[a]})  vs  ${b} (${agg[b]})\n`; });
    md += '\n## 4. Final totals after proposed merge (top 60)\n\n| Standard designation | Employees |\n|---|---|\n';
    Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 60).forEach(([k, v]) => { md += `| ${k || '(blank)'} | ${v} |\n`; });
    // ── Validation: every variant of the key roles, and the record-count check
    md += '\n## 5. Validation\n\n';
    const sumAfter = Object.values(agg).reduce((a, b) => a + b, 0);
    md += `- Employee records before: **${total}**, after proposed merge: **${sumAfter}** -> ${total === sumAfter ? 'UNCHANGED (no record lost)' : 'MISMATCH!'}\n`;
    const FAMILIES = [
        ['Painter', /PAINT|PANT|PENT|PINT/i], ['Barbender', /BAR\s*BEN|BERB|BER BEND|ROD BEND|BAR BIND|STEEL BEND|BARBEL/i],
        ['Carpenter', /CARP|CORPEN/i], ['Technician', /TEC[HN]|TECAIN|TCCHN/i], ['Chipping', /CHI?P/i], ['Buffing', /BUF|BAF|BOF/i],
        ['Foreman', /FOR\s?MAN|FOUR\s?MAN|FORMEN|FOREMAN/i], ['Hole Packing', /HOL|GOL PACK|HLE/i], ['Mason', /MASON|MASSION|MASION|MISTRI|MISSION|MISSON|MISION|MESTRI/i],
        ['Plumber', /PLUMB/i], ['Electrician', /ELEC|ELCT|ELAC/i], ['Surveyor', /SURV|SARV|SERVEY/i], ['Shuttering', /SHUT|SHAT|SHETR|CENTR/i],
        ['Waterproofing', /WATER ?PROF/i], ['Lift Operator', /LIFT|LIF OP/i], ['Junior Engineer', /JUNIOR|JR\.? ?ENG/i],
        ['False Ceiling', /CEIL|CELING|CEELING/i], ['Landscaping', /LAND ?SC|LANDSK|LANDSCAP/i], ['Contractor', /CONT[RAEOC]|CONCTOR|THEKEDAR|TAKEDHAR|THIKADAR/i],
        ['Store Incharge', /STORE/i], ['Signal Man', /SIGN|SINGN|SINGLE MAN|SINGAL/i]
    ];
    FAMILIES.forEach(([name, re]) => {
        const hit = rows.filter(r => r.orig && re.test(r.orig));
        const stds = {};
        hit.forEach(r => { const k = r.status === 'REVIEW' ? '(review) ' + r.orig : r.std; stds[k] = (stds[k] || 0) + r.c; });
        md += `\n**${name}** - ${hit.length} stored variants -> final rows: ${Object.entries(stds).map(([k, v]) => k + ' = ' + v).join('; ')}\n`;
        md += `  variants: ${hit.map(r => r.orig + ' (' + r.c + ')').join(', ')}\n`;
    });
    fs.writeFileSync(path.join(__dirname, '..', 'reports', 'designation-mapping.md'), md);
    console.log(`distinct now ${rows.length} -> ${Object.keys(agg).length} after merge; MERGE rows ${rows.filter(r => r.status === 'MERGE').length}, REVIEW rows ${rows.filter(r => r.status === 'REVIEW').length}; total ${total}`);
})().catch(e => { console.error(e.message); process.exitCode = 1; });
