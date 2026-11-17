// Club contractor spelling/case variants in the database.
//   node scripts/merge-contractors.js            -> dry run (prints what would change)
//   node scripts/merge-contractors.js --apply    -> applies, writes backup to scripts/backup-contractors-<ts>.json
//   node scripts/merge-contractors.js --restore <backup.json>  -> undo
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const N = require('../public/contractor-normalizer.js');

const apply = process.argv.includes('--apply');
const restoreIdx = process.argv.indexOf('--restore');

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const db = mongoose.connection.db;
    const emps = db.collection('employees');
    const master = db.collection('masterdatas');

    if (restoreIdx > -1) {
        const b = JSON.parse(fs.readFileSync(process.argv[restoreIdx + 1], 'utf8'));
        const { ObjectId } = mongoose.Types;
        if (b.employees.length) await emps.bulkWrite(b.employees.map(e => ({ updateOne: { filter: { _id: new ObjectId(e._id) }, update: { $set: e.before } } })));
        for (const l of b.lists) await master.updateOne({ _id: new ObjectId(l._id) }, { $set: { data: l.before } });
        console.log('Restored ' + b.employees.length + ' records and ' + b.lists.length + ' lists.');
        return;
    }

    const changes = [];
    const summary = {};
    for await (const e of emps.find({}, { projection: { contractor: 1, subContractor: 1 } })) {
        if (!e.contractor) continue;
        const to = N.normalizeContractor(e.contractor);
        if (to === e.contractor) continue;
        const sub = N.extractSubName(e.contractor);
        const set = { contractor: to };
        if (sub && !String(e.subContractor || '').trim()) set.subContractor = sub;
        changes.push({ _id: e._id, before: { contractor: e.contractor, subContractor: e.subContractor || '' }, set });
        const k = `${e.contractor}  ->  ${to}`;
        summary[k] = (summary[k] || 0) + 1;
    }

    const lists = [];
    for await (const d of master.find({ type: 'contractors' })) {
        const cleaned = N.normalizeList(d.data);
        if (JSON.stringify(cleaned) !== JSON.stringify(d.data)) lists.push({ _id: d._id, site: d.site, before: d.data, after: cleaned });
    }

    console.log(`Employee records to change: ${changes.length}`);
    Object.entries(summary).sort().forEach(([k, n]) => console.log(`  ${String(n).padStart(4)} x ${k}`));
    console.log(`Contractor master lists to clean: ${lists.length}`);
    lists.forEach(l => console.log(`  site=${l.site || 'GLOBAL'}: ${l.before.length} -> ${l.after.length} entries`));

    if (!apply) { console.log('\nDRY RUN - nothing written. Re-run with --apply.'); return; }

    const backup = path.join(__dirname, `backup-contractors-${Date.now()}.json`);
    fs.writeFileSync(backup, JSON.stringify({ employees: changes.map(c => ({ _id: c._id, before: c.before })), lists: lists.map(l => ({ _id: l._id, before: l.before })) }, null, 1));
    if (changes.length) await emps.bulkWrite(changes.map(c => ({ updateOne: { filter: { _id: c._id }, update: { $set: c.set } } })));
    for (const l of lists) await master.updateOne({ _id: l._id }, { $set: { data: l.after } });
    console.log(`\nApplied. Backup (old values) saved to ${backup}`);
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
