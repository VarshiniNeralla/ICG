'use strict';

/**
 * ENTRY PASS – ADMIN PANEL v1.0
 * Dashboard, Records, CRUD Management, Settings
 */

const API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:5000'
    : window.location.origin;
const ADMIN_CREDS = { user: 'admin', pass: 'admin@123' };

const formatDate = (d) => {
    if (!d) return '---';
    if (typeof d === 'string' && /^\d{2}-\d{2}-\d{4}$/.test(d)) return d;
    const date = new Date(d);
    if (isNaN(date.getTime())) return d;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
};

// DOM
const loginScreen = document.getElementById('adminLogin');
const dashboard = document.getElementById('adminDashboard');
const loginForm = document.getElementById('adminLoginForm');
const loginError = document.getElementById('loginError');

// ------ LOGIN ------
loginForm.onsubmit = (e) => {
    e.preventDefault();
    const u = document.getElementById('adminUser').value.trim();
    const p = document.getElementById('adminPass').value;
    if (u === ADMIN_CREDS.user && p === ADMIN_CREDS.pass) {
        sessionStorage.setItem('ep_admin', 'true');
        checkState();
    } else {
        loginError.textContent = 'Invalid credentials.';
    }
};

function checkState() {
    if (sessionStorage.getItem('ep_admin') === 'true') {
        loginScreen.style.display = 'none';
        dashboard.style.display = 'block';
        const savedTab = sessionStorage.getItem('ep_admin_tab') || 'dashboard';
        const tabBtn = document.querySelector(`.tab-btn[data-tab="${savedTab}"]`);
        if (tabBtn) tabBtn.click();
        else loadDashboard();
    }
}

document.getElementById('btnAdminLogout').onclick = () => {
    sessionStorage.removeItem('ep_admin');
    sessionStorage.removeItem('ep_admin_tab');
    window.location.reload();
};

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
        const tabName = btn.dataset.tab;
        sessionStorage.setItem('ep_admin_tab', tabName);
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + tabName).classList.add('active');
        if (tabName === 'dashboard') loadDashboard();
        if (tabName === 'records') loadRecords();
        if (tabName === 'manage') loadManageLists();
        if (tabName === 'settings') loadSettings();
    };
});

// ------ DASHBOARD ------
function animateCounter(el, target) {
    const duration = 1200;
    const start = performance.now();
    const from = parseInt(el.textContent) || 0;
    function tick(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(from + (target - from) * eased);
        if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

async function loadDashboard() {
    try {
        const resp = await fetch(`${API}/api/stats`);
        const data = await resp.json();
        animateCounter(document.getElementById('statTotal'), data.total || 0);
        animateCounter(document.getElementById('statToday'), data.today || 0);
        animateCounter(document.getElementById('statWeek'), data.week || 0);
        animateCounter(document.getElementById('statMonth'), data.month || 0);

        // Update Labels with Actual Date/Month
        const now = new Date();
        const dateOptions = { day: 'numeric', month: 'short' };
        const monthOptions = { month: 'long' };
        document.getElementById('labelToday').textContent = `Today (${now.toLocaleDateString('en-US', dateOptions)})`;
        document.getElementById('labelMonth').textContent = `${now.toLocaleDateString('en-US', monthOptions)} Total`;
        const first = now.getDate() - now.getDay();
        const firstDay = new Date(new Date().setDate(first));
        const lastDay = new Date(new Date().setDate(first + 6));
        document.getElementById('labelWeek').textContent = `Week (${firstDay.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} - ${lastDay.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })})`;

        renderBarChart('siteChartArea', data.bySite || {});
        renderBarChart('contractorChartArea', data.byContractor || {});
    } catch (err) { console.error('Dashboard load failed:', err); }
}

const BAR_GRADIENTS = [
    ['#1a3c6e', '#2d5aa0'], ['#c8a45a', '#dab96e'], ['#10b981', '#34d399'],
    ['#6366f1', '#818cf8'], ['#f59e0b', '#fbbf24'], ['#ef4444', '#f87171'],
    ['#8b5cf6', '#a78bfa'], ['#ec4899', '#f472b6']
];

function renderBarChart(containerId, dataObj) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const entries = Object.entries(dataObj);
    if (entries.length === 0) {
        container.innerHTML = '<p style="color:var(--text-light); font-size:0.85rem; text-align:center; padding:3rem 0;">No data available</p>';
        return;
    }
    const maxVal = Math.max(...entries.map(e => e[1]), 1);
    const total = entries.reduce((s, e) => s + e[1], 0);
    container.innerHTML = `<div class="bar-chart">${entries.map(([label, value], i) => {
        const [c1, c2] = BAR_GRADIENTS[i % BAR_GRADIENTS.length];
        const pct = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
        return `
        <div class="bar-group">
            <span class="bar-value">${value}</span>
            <div class="bar" style="height: ${(value / maxVal) * 140}px; background: linear-gradient(180deg, ${c2}, ${c1});">
                <div class="bar-tooltip">${label}: ${value} (${pct}%)</div>
            </div>
            <span class="bar-label">${label}</span>
        </div>`;
    }).join('')}</div>`;
}

// ------ RECORDS ------
let currentRecords = [];

function sortAndRenderRecords() {
    const sortKey = document.getElementById('sortRecords').value;
    const sorted = [...currentRecords];
    switch (sortKey) {
        case 'latest': sorted.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)); break;
        case 'oldest': sorted.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0)); break;
        case 'age_asc': sorted.sort((a, b) => (parseInt(a.age) || 0) - (parseInt(b.age) || 0)); break;
        case 'age_desc': sorted.sort((a, b) => (parseInt(b.age) || 0) - (parseInt(a.age) || 0)); break;
        case 'name_az': sorted.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || '')); break;
        case 'name_za': sorted.sort((a, b) => (b.fullName || '').localeCompare(a.fullName || '')); break;
        case 'gender': sorted.sort((a, b) => (a.gender || '').localeCompare(b.gender || '')); break;
        case 'designation': sorted.sort((a, b) => (a.designation || '').localeCompare(b.designation || '')); break;
        case 'site': sorted.sort((a, b) => (a.site || '').localeCompare(b.site || '')); break;
        case 'camp': sorted.sort((a, b) => (a.laborCamp || '').localeCompare(b.laborCamp || '')); break;
    }
    renderRecordsTable(sorted);
}

function renderRecordsTable(records) {
    const tbody = document.getElementById('recordsBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="17" style="text-align:center; padding:2rem; color:var(--text-light);">No records found</td></tr>';
        return;
    }
    records.forEach((r) => {
        let photoSrc = "";
        if (r.photoPath) {
            const cleanPath = r.photoPath.replace(/\\/g, '/');
            photoSrc = r.photoPath.startsWith('http') ? r.photoPath : `${API}/${cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath}`;
        }
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${photoSrc ? `<img src="${photoSrc}" class="record-photo" alt="Photo" />` : 'N/A'}</td>
            <td>${r.fullName || '---'}</td>
            <td>${r.aadhar || '---'}</td>
            <td>${r.age || '---'}</td>
            <td>${r.gender || '---'}</td>
            <td>${formatDate(r.dob)}</td>
            <td>${r.bloodGroup || '---'}</td>
            <td>${r.contractor || '---'}</td>
            <td>${r.laborCamp || '---'}</td>
            <td>${r.designation || '---'}</td>
            <td>${r.contact || '---'}</td>
            <td>${r.site || 'EMPTY'}</td>
            <td>${r.operator || 'EMPTY'}</td>
            <td>${formatDate(r.doi)}</td>
            <td>${formatDate(r.validity)}</td>
            <td>${formatDate(r.issueDate)}</td>
            <td><button class="btn-delete" onclick="deleteRecord('${r._id}')">Delete</button></td>`;
        tbody.appendChild(tr);
    });
}

async function loadRecords(from, to) {
    try {
        let url = `${API}/api/employees`;
        const params = [];
        if (!from && !to) {
            const retention = localStorage.getItem('ep_retention') || '1m';
            const now = new Date();
            let cutoff = null;
            if (retention === '1d') cutoff = new Date(now.setDate(now.getDate() - 1));
            else if (retention === '1w') cutoff = new Date(now.setDate(now.getDate() - 7));
            else if (retention === '1m') cutoff = new Date(now.setMonth(now.getMonth() - 1));
            else if (retention === '1y') cutoff = new Date(now.setFullYear(now.getFullYear() - 1));
            else if (retention.startsWith('custom_')) cutoff = new Date(new Date().setDate(new Date().getDate() - parseInt(retention.split('_')[1])));
            if (cutoff && retention !== 'all') from = cutoff.toISOString().split('T')[0];
        }
        if (from) params.push(`from=${from}`);
        if (to) params.push(`to=${to}`);
        if (params.length) url += '?' + params.join('&');
        const resp = await fetch(url);
        currentRecords = await resp.json();
        sortAndRenderRecords();
    } catch (err) { console.error('Records load failed:', err); }
}

async function deleteRecord(id) {
    const confirmed = await showConfirm('Delete this record permanently? This action cannot be undone.');
    if (!confirmed) return;
    try {
        await fetch(`${API}/api/employees/${id}`, { method: 'DELETE' });
        showAlert('Record deleted successfully.');
        loadRecords();
    } catch (err) { console.error('Delete failed:', err); }
}

document.getElementById('btnApplyFilter').onclick = () => loadRecords(document.getElementById('filterFrom').value, document.getElementById('filterTo').value);
document.getElementById('btnResetFilter').onclick = () => {
    document.getElementById('filterFrom').value = '';
    document.getElementById('filterTo').value = '';
    document.getElementById('sortRecords').value = 'latest';
    loadRecords();
};
document.getElementById('sortRecords').onchange = sortAndRenderRecords;
document.getElementById('btnExportExcel').onclick = () => {
    const table = document.getElementById('recordsTable');
    const rows = table.querySelectorAll('tr');
    let csv = ''; rows.forEach(row => {
        const cells = row.querySelectorAll('th, td');
        const rowData = []; cells.forEach((cell, idx) => {
            if (idx === 0 || idx === cells.length - 1) return;
            rowData.push('"' + cell.textContent.replace(/"/g, '""').trim() + '"');
        });
        csv += rowData.join(',') + '\n';
    });
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `EntryPass_Records_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
};

// ------ MANAGE (CRUD) ------
async function getListAPI(key) {
    try {
        const res = await fetch(`${API}/api/${key}`);
        return res.ok ? await res.json() : [];
    } catch (e) { console.error(e); return []; }
}
async function saveListAPI(key, arr) {
    try {
        await fetch(`${API}/api/${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: arr })
        });
    } catch (e) { console.error(e); }
}

function toggleAddForm(key) {
    const area = document.getElementById(`addArea-${key}`);
    const toggleBtn = area.querySelector('.btn-add-toggle');
    const form = area.querySelector('.manage-add-form');
    const isHidden = form.style.display === 'none';
    form.style.display = isHidden ? 'block' : 'none';
    toggleBtn.style.display = isHidden ? 'none' : 'block';
    if (isHidden) { const input = form.querySelector('input'); input.value = ''; input.focus(); }
}

async function renderManageList(key, listId) {
    const items = await getListAPI(key);
    const ul = document.getElementById(listId);
    if (!ul) return;
    ul.innerHTML = '';
    items.forEach((item, idx) => {
        const li = document.createElement('li');
        li.id = `item-${key}-${idx}`;
        li.innerHTML = `
            <span class="item-text">${item}</span>
            <div class="manage-actions">
                <button class="btn-edit" onclick="startInlineEdit('${key}', ${idx}, '${listId}')">Edit</button>
                <button class="btn-remove" onclick="confirmRemoveItem('${key}', ${idx}, '${listId}')">Del</button>
            </div>`;
        ul.appendChild(li);
    });
}

function startInlineEdit(key, idx, listId) {
    const li = document.getElementById(`item-${key}-${idx}`);
    const span = li.querySelector('.item-text');
    const originalVal = span.textContent;
    li.innerHTML = `
        <input type="text" class="inline-edit-input" value="${originalVal}" />
        <div class="manage-actions">
            <button class="btn btn-primary btn-sm btn-save-inline">Save</button>
            <button class="btn btn-secondary btn-sm btn-cancel-inline">Cancel</button>
        </div>`;
    const input = li.querySelector('input'); input.focus(); input.select();
    li.querySelector('.btn-save-inline').onclick = () => saveInlineEdit(key, idx, listId, input.value, originalVal);
    li.querySelector('.btn-cancel-inline').onclick = () => renderManageList(key, listId);
    input.onkeyup = (e) => {
        if (e.key === 'Enter') saveInlineEdit(key, idx, listId, input.value, originalVal);
        if (e.key === 'Escape') renderManageList(key, listId);
    };
}

async function saveInlineEdit(key, idx, listId, newVal, oldVal) {
    newVal = newVal.trim();
    if (!newVal || newVal === oldVal) return renderManageList(key, listId);
    const items = await getListAPI(key);
    items[idx] = newVal; await saveListAPI(key, items);
    document.getElementById(`item-${key}-${idx}`).innerHTML = `<span class="inline-edit-success">✓ Updated</span><span class="item-text" style="font-weight:700;">${newVal}</span>`;
    setTimeout(() => renderManageList(key, listId), 2000);
}

async function confirmRemoveItem(key, idx, listId) {
    const items = await getListAPI(key);
    if (await showConfirm(`Delete "${items[idx]}" permanently?`)) {
        items.splice(idx, 1); await saveListAPI(key, items);
        document.getElementById(`item-${key}-${idx}`).innerHTML = `<div class="delete-success-msg">✓ Deleted successfully</div>`;
        setTimeout(() => renderManageList(key, listId), 2000);
    }
}

async function addItem(key, inputId, listId) {
    const input = document.getElementById(inputId);
    const val = input.value.trim();
    if (!val) return;
    const items = await getListAPI(key);
    if (items.includes(val)) return showAlert('Item already exists.');
    items.push(val); await saveListAPI(key, items);
    toggleAddForm(key);
    const area = document.getElementById(`addArea-${key}`);
    const success = area.querySelector('.add-success-msg');
    success.textContent = '✓ Added successfully';
    renderManageList(key, listId);
    setTimeout(() => success.textContent = '', 3000);
}

async function loadManageLists() {
    await renderManageList('sites', 'siteList');
    await renderManageList('contractors', 'contractorList');
    await renderManageList('roles', 'roleList');
}

document.getElementById('addSite').onclick = () => addItem('sites', 'siteInput', 'siteList');
document.getElementById('addContractor').onclick = () => addItem('contractors', 'contractorInput', 'contractorList');
document.getElementById('addRole').onclick = () => addItem('roles', 'roleInput', 'roleList');

// ------ SETTINGS ------
function loadSettings() {
    const saved = localStorage.getItem('ep_retention') || '1m';
    document.querySelectorAll('input[name="retention"]').forEach(r => r.checked = r.value === saved);
    if (saved.startsWith('custom_')) {
        document.querySelector('input[name="retention"][value="custom"]').checked = true;
        document.getElementById('customDays').value = saved.split('_')[1];
        document.getElementById('customDays').disabled = false;
    }
}

document.querySelectorAll('input[name="retention"]').forEach(r => {
    r.onclick = () => {
        document.getElementById('customDays').disabled = r.value !== 'custom';
        if (r.value === 'custom') document.getElementById('customDays').focus();
    };
});

document.getElementById('saveRetention').onclick = () => {
    const s = document.querySelector('input[name="retention"]:checked');
    if (!s) return;
    let v = s.value;
    if (v === 'custom') {
        const d = document.getElementById('customDays').value;
        if (!d || d < 1) return showAlert('Enter valid number of days.');
        v = 'custom_' + d;
    }
    localStorage.setItem('ep_retention', v);
    document.getElementById('retentionStatus').textContent = 'Settings saved and applied!';
    loadRecords();
    setTimeout(() => document.getElementById('retentionStatus').textContent = '', 3000);
};

// ------ MODAL UTILITIES ------
document.getElementById('closeAlert').onclick = () => document.getElementById('customAlert').style.display = 'none';
function showAlert(msg) { document.getElementById('alertMessage').textContent = msg; document.getElementById('customAlert').style.display = 'flex'; }
function showConfirm(msg) {
    return new Promise((resolve) => {
        document.getElementById('confirmMessage').textContent = msg;
        document.getElementById('confirmModal').style.display = 'flex';
        document.getElementById('confirmYes').onclick = () => { document.getElementById('confirmModal').style.display = 'none'; resolve(true); };
        document.getElementById('confirmNo').onclick = () => { document.getElementById('confirmModal').style.display = 'none'; resolve(false); };
    });
}

checkState();
