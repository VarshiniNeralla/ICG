'use strict';

/**
 * ENTRY PASS – ADMIN PANEL v1.0
 * Dashboard, Records, CRUD Management, Settings
 */

const API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:5000'
    : window.location.origin;
const ADMIN_CREDS = { user: 'admin', pass: 'admin@123' };

// Color palette for chart bars
const BAR_COLORS = ['#1a3c6e', '#c8a45a', '#10b981', '#6366f1', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

const formatDate = (d) => {
    if (!d) return '---';
    const date = new Date(d);
    if (isNaN(date.getTime())) return d; // Return raw (like already formatted)
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
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
        checkState(); // Use consolidated checkState
    } else {
        loginError.textContent = 'Invalid credentials.';
    }
};

function checkState() {
    if (sessionStorage.getItem('ep_admin') === 'true') {
        loginScreen.style.display = 'none';
        dashboard.style.display = 'block';

        // Restore active tab or default to dashboard
        const savedTab = sessionStorage.getItem('ep_admin_tab') || 'dashboard';
        const tabBtn = document.querySelector(`.tab-btn[data-tab="${savedTab}"]`);
        if (tabBtn) {
            tabBtn.click();
        } else {
            loadDashboard();
        }
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

        // Load data when tab activates
        if (tabName === 'dashboard') loadDashboard();
        if (tabName === 'records') loadRecords();
        if (tabName === 'manage') loadManageLists();
        if (tabName === 'settings') loadSettings();
    };
});

// ------ DASHBOARD ------
async function loadDashboard() {
    try {
        const resp = await fetch(`${API}/api/stats`);
        const data = await resp.json();

        document.getElementById('statTotal').textContent = data.total || 0;
        document.getElementById('statToday').textContent = data.today || 0;
        document.getElementById('statWeek').textContent = data.week || 0;
        document.getElementById('statMonth').textContent = data.month || 0;

        renderBarChart('siteChartArea', data.bySite || {});
        renderBarChart('contractorChartArea', data.byContractor || {});
    } catch (err) {
        console.error('Dashboard load failed:', err);
    }
}

function renderBarChart(containerId, dataObj) {
    const container = document.getElementById(containerId);
    const entries = Object.entries(dataObj);
    if (entries.length === 0) {
        container.innerHTML = '<p style="color:var(--text-light); font-size:0.85rem; text-align:center; padding:3rem 0;">No data available</p>';
        return;
    }

    const maxVal = Math.max(...entries.map(e => e[1]), 1);
    const chartHtml = `<div class="bar-chart">${entries.map(([label, value], i) => `
        <div class="bar-group">
            <span class="bar-value">${value}</span>
            <div class="bar" style="height: ${(value / maxVal) * 180}px; background: ${BAR_COLORS[i % BAR_COLORS.length]};"></div>
            <span class="bar-label">${label}</span>
        </div>`).join('')}
    </div>`;
    container.innerHTML = chartHtml;
}

// ------ RECORDS ------
async function loadRecords(from, to) {
    try {
        let url = `${API}/api/employees`;
        const params = [];

        // Apply retention setting if no date filter is active
        if (!from && !to) {
            const retention = localStorage.getItem('ep_retention') || '1m';
            const now = new Date();
            let cutoff = null;

            if (retention === '1d') cutoff = new Date(now.setDate(now.getDate() - 1));
            else if (retention === '1w') cutoff = new Date(now.setDate(now.getDate() - 7));
            else if (retention === '1m') cutoff = new Date(now.setMonth(now.getMonth() - 1));
            else if (retention === '1y') cutoff = new Date(now.setFullYear(now.getFullYear() - 1));
            else if (retention.startsWith('custom_')) {
                const days = parseInt(retention.split('_')[1]);
                cutoff = new Date(now.setDate(now.getDate() - days));
            }

            if (cutoff && retention !== 'all') {
                from = cutoff.toISOString().split('T')[0];
            }
        }

        if (from) params.push(`from=${from}`);
        if (to) params.push(`to=${to}`);
        if (params.length) url += '?' + params.join('&');

        const resp = await fetch(url);
        const records = await resp.json();
        console.log('--- ADMIN RECORDS AUDIT ---');
        console.log('Total records received:', records.length);
        if (records.length > 0) console.log('Sample record image field:', records[0].photoPath);

        const tbody = document.getElementById('recordsBody');
        tbody.innerHTML = '';

        if (records.length === 0) {
            tbody.innerHTML = '<tr><td colspan="17" style="text-align:center; padding:2rem; color:var(--text-light);">No records found</td></tr>';
            return;
        }

        records.forEach((r, idx) => {
            // FIX: Ensure photoSrc handles Cloudinary URLs and local paths robustly
            let photoSrc = "";
            if (r.photoPath) {
                if (r.photoPath.startsWith('http')) {
                    photoSrc = r.photoPath;
                } else {
                    // Normalize backslashes (if any) and ensure path starts correctly
                    const cleanPath = r.photoPath.replace(/\\/g, '/');
                    const separator = cleanPath.startsWith('/') ? '' : '/';
                    photoSrc = `${API}${separator}${cleanPath}`;
                }
            }
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${photoSrc ? `<img src="${photoSrc}" class="record-photo" alt="Photo" />` : '<span style="color:var(--text-light)">N/A</span>'}</td>
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
    } catch (err) {
        console.error('Records load failed:', err);
    }
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

// Filter & Export
document.getElementById('btnApplyFilter').onclick = () => {
    const from = document.getElementById('filterFrom').value;
    const to = document.getElementById('filterTo').value;
    loadRecords(from, to);
};

document.getElementById('btnResetFilter').onclick = () => {
    document.getElementById('filterFrom').value = '';
    document.getElementById('filterTo').value = '';
    loadRecords();
};

document.getElementById('btnExportExcel').onclick = () => {
    const table = document.getElementById('recordsTable');
    const rows = table.querySelectorAll('tr');
    // Column indices to SKIP: 0 (Photo) and last (Actions)
    const SKIP_COLS = new Set([0]);
    let csv = '';
    rows.forEach(row => {
        const cells = row.querySelectorAll('th, td');
        const rowData = [];
        cells.forEach((cell, idx) => {
            if (SKIP_COLS.has(idx)) return; // Skip Photo column
            if (idx === cells.length - 1) return; // Skip Actions column
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
// Local storage for sites, contractors, roles
function getList(key) {
    const data = localStorage.getItem('ep_' + key);
    return data ? JSON.parse(data) : [];
}

function saveList(key, arr) {
    localStorage.setItem('ep_' + key, JSON.stringify(arr));
}

function renderManageList(key, listId) {
    const items = getList(key);
    const ul = document.getElementById(listId);
    if (!ul) return;
    ul.innerHTML = '';
    items.forEach((item, idx) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${item}</span>
            <div class="manage-actions">
                <button class="btn-edit" onclick="editItem('${key}', ${idx}, '${listId}')">Edit</button>
                <button class="btn-remove" onclick="removeItem('${key}', ${idx}, '${listId}')">Del</button>
            </div>`;
        ul.appendChild(li);
    });
}

function addItem(key, inputId, listId) {
    const input = document.getElementById(inputId);
    const val = input.value.trim();
    if (!val) return;
    const items = getList(key);
    if (items.includes(val)) return showAlert('Item already exists.');
    items.push(val);
    saveList(key, items);
    input.value = '';
    renderManageList(key, listId);
}

function removeItem(key, idx, listId) {
    const items = getList(key);
    items.splice(idx, 1);
    saveList(key, items);
    renderManageList(key, listId);
}

async function editItem(key, idx, listId) {
    const items = getList(key);
    const newVal = await showPrompt('Enter updated value:', items[idx]);
    if (newVal !== null && newVal.trim() !== '' && newVal !== items[idx]) {
        items[idx] = newVal.trim();
        saveList(key, items);
        renderManageList(key, listId);
        showAlert('Updated successfully.');
    }
}

function loadManageLists() {
    // Seed defaults if empty
    if (getList('sites').length === 0) saveList('sites', ['Grava', 'Apas', 'Vipina']);
    if (getList('contractors').length === 0) saveList('contractors', ['KLC PVT LTD', 'Sri Infra Works', 'Reddy Constructions']);
    if (getList('roles').length === 0) saveList('roles', ['Worker', 'IT Engineer', 'MEP', 'Safety', 'Quality', 'Others']);

    renderManageList('sites', 'siteList');
    renderManageList('contractors', 'contractorList');
    renderManageList('roles', 'roleList');
}

// Wire CRUD buttons
document.getElementById('addSite').onclick = () => addItem('sites', 'siteInput', 'siteList');
document.getElementById('addContractor').onclick = () => addItem('contractors', 'contractorInput', 'contractorList');
document.getElementById('addRole').onclick = () => addItem('roles', 'roleInput', 'roleList');

// ------ SETTINGS ------
function loadSettings() {
    const saved = localStorage.getItem('ep_retention') || '1m';
    document.querySelectorAll('input[name="retention"]').forEach(r => {
        r.checked = r.value === saved;
    });

    const customRadio = document.querySelector('input[name="retention"][value="custom"]');
    const customInput = document.getElementById('customDays');
    if (saved.startsWith('custom_')) {
        customRadio.checked = true;
        customInput.value = saved.split('_')[1];
        customInput.disabled = false;
    }
}

// Enable custom days input when custom is selected
document.querySelectorAll('input[name="retention"]').forEach(r => {
    r.onclick = () => {
        document.getElementById('customDays').disabled = r.value !== 'custom';
        if (r.value === 'custom') document.getElementById('customDays').focus();
    };
});

document.getElementById('saveRetention').onclick = () => {
    const selected = document.querySelector('input[name="retention"]:checked');
    if (!selected) return;

    let val = selected.value;
    if (val === 'custom') {
        const days = document.getElementById('customDays').value;
        if (!days || days < 1) return showAlert('Enter valid number of days.');
        val = 'custom_' + days;
    }

    localStorage.setItem('ep_retention', val);
    document.getElementById('retentionStatus').textContent = 'Settings saved and applied!';

    // Auto-refresh the records with the new retention period
    loadRecords();

    setTimeout(() => document.getElementById('retentionStatus').textContent = '', 3000);
};

// ------ MODAL UTILITIES ------
document.getElementById('closeAlert').onclick = () => {
    document.getElementById('customAlert').style.display = 'none';
};

function showAlert(msg) {
    document.getElementById('alertMessage').textContent = msg;
    document.getElementById('customAlert').style.display = 'flex';
}

function showConfirm(msg) {
    return new Promise((resolve) => {
        document.getElementById('confirmMessage').textContent = msg;
        document.getElementById('confirmModal').style.display = 'flex';
        document.getElementById('confirmYes').onclick = () => {
            document.getElementById('confirmModal').style.display = 'none';
            resolve(true);
        };
        document.getElementById('confirmNo').onclick = () => {
            document.getElementById('confirmModal').style.display = 'none';
            resolve(false);
        };
    });
}

function showPrompt(msg, defaultValue) {
    return new Promise((resolve) => {
        document.getElementById('promptMessage').textContent = msg;
        const input = document.getElementById('promptInput');
        input.value = defaultValue || '';
        document.getElementById('promptModal').style.display = 'flex';
        input.focus();
        document.getElementById('promptOk').onclick = () => {
            document.getElementById('promptModal').style.display = 'none';
            resolve(input.value);
        };
        document.getElementById('promptCancel').onclick = () => {
            document.getElementById('promptModal').style.display = 'none';
            resolve(null);
        };
    });
}

// ------ INIT ------
// Everything is initialized via checkState() at the end of the script
checkState();
