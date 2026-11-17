// Standardize designation names in the database.
//   node scripts/merge-designations.js            -> dry run
//   node scripts/merge-designations.js --apply    -> apply (backup written to scripts/backup-designations-<ts>.json)
//   node scripts/merge-designations.js --restore <backup.json>  -> undo
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const N = require('../public/designation-normalizer.js');
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
        if (b.employees.length) await emps.bulkWrite(b.employees.map(e => ({ updateOne: { filter: { _id: new ObjectId(e._id) }, update: { $set: { designation: e.before } } } })));
        for (const l of b.lists) await master.updateOne({ _id: new ObjectId(l._id) }, { $set: { data: l.before } });
        console.log('Restored ' + b.employees.length + ' records and ' + b.lists.length + ' lists.');
        return;
    }

    const groups = await emps.aggregate([{ $group: { _id: '$designation', c: { $sum: 1 } } }]).toArray();
    const changes = [];
    const summary = [];
    for (const g of groups) {
        if (!g._id) continue;
        const to = N.normalizeDesignation(g._id);
        if (to === g._id) continue;
        summary.push(g.c + ' x ' + g._id + '  ->  ' + to);
        if (apply) (await emps.find({ designation: g._id }, { projection: { _id: 1 } }).toArray()).forEach(d => changes.push({ _id: d._id, before: g._id, to }));
        else changes.push(...Array(g.c).fill(null));
    }
    const lists = [];
    for await (const d of master.find({ type: 'roles' })) {
        const cleaned = N.normalizeList(d.data);
        if (JSON.stringify(cleaned) !== JSON.stringify(d.data)) lists.push({ _id: d._id, site: d.site, before: d.data, after: cleaned });
    }
    console.log('Employee records to change: ' + changes.length);
    summary.sort((a, b) => parseInt(b) - parseInt(a)).forEach(l => console.log('  ' + l));
    console.log('Designation master lists to clean: ' + lists.length);
    lists.forEach(l => console.log('  site=' + (l.site || 'GLOBAL') + ': ' + l.before.length + ' -> ' + l.after.length + ' entries'));
    if (!apply) { console.log('\nDRY RUN - nothing written. Re-run with --apply.'); return; }

    const backup = path.join(__dirname, 'backup-designations-' + Date.now() + '.json');
    fs.writeFileSync(backup, JSON.stringify({ employees: changes.map(c => ({ _id: c._id, before: c.before })), lists: lists.map(l => ({ _id: l._id, before: l.before })) }));
    const byTarget = {};
    changes.forEach(c => { (byTarget[c.to] = byTarget[c.to] || []).push(c._id); });
    for (const [to, ids] of Object.entries(byTarget)) await emps.updateMany({ _id: { $in: ids } }, { $set: { designation: to } });
    for (const l of lists) await master.updateOne({ _id: l._id }, { $set: { data: l.after } });
    console.log('\nApplied. Backup saved to ' + backup);
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
