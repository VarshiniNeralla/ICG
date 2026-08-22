'use strict';

/**
 * ENTRY PASS – ADMIN PANEL v1.0
 * Dashboard, Records, CRUD Management, Settings
 */

const API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:5000'
    : window.location.origin;
let adminToken = sessionStorage.getItem('ep_admin_token') || null;

// HTML escape helper to prevent XSS
function esc(str) { const d = document.createElement('div'); d.textContent = str || ''; return d.innerHTML; }

// Auth header helper
function adminHeaders(extra = {}) {
    const headers = { ...extra };
    if (adminToken) headers['Authorization'] = `Bearer ${adminToken}`;
    return headers;
}

// Handle 401 — force re-login when token is invalid or expired
function handleAuthError(resp) {
    if (resp.status === 401 || resp.status === 403) {
        sessionStorage.removeItem('ep_admin');
        sessionStorage.removeItem('ep_admin_tab');
        sessionStorage.removeItem('ep_admin_token');
        adminToken = null;
        window.location.reload();
        return true;
    }
    return false;
}

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

const formatDateTime = (d) => {
    if (!d) return '<span style="color:var(--text-light)">—</span>';
    const date = new Date(d);
    if (isNaN(date.getTime())) return '<span style="color:var(--text-light)">—</span>';
    let hours = date.getHours();
    const mins = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `<span class="time-badge">${hours}:${mins} <span class="time-ampm">${ampm}</span></span>`;
};

// DOM
const loginScreen = document.getElementById('adminLogin');
const dashboard = document.getElementById('adminDashboard');
const loginForm = document.getElementById('adminLoginForm');
const loginError = document.getElementById('loginError');
const toggleAdminPassword = document.getElementById('toggleAdminPassword');
const adminPassInput = document.getElementById('adminPass');

if (toggleAdminPassword) {
    toggleAdminPassword.onclick = () => {
        const type = adminPassInput.getAttribute('type') === 'password' ? 'text' : 'password';
        adminPassInput.setAttribute('type', type);
        toggleAdminPassword.querySelector('svg').style.color = type === 'text' ? 'var(--primary)' : 'var(--text-light)';
    };
}


// ------ LOGIN ------
loginForm.onsubmit = async (e) => {
    e.preventDefault();
    const u = document.getElementById('adminUser').value.trim();
    const p = document.getElementById('adminPass').value.trim();
    try {
        const resp = await fetch(`${API}/api/auth/admin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: u, password: p })
        });
        const result = await resp.json();
        if (!resp.ok) {
            loginError.textContent = result.error || 'Invalid credentials.';
            return;
        }
        adminToken = result.token;
        sessionStorage.setItem('ep_admin', 'true');
        sessionStorage.setItem('ep_admin_token', adminToken);
        if (result.site) sessionStorage.setItem('ep_admin_site', result.site);
        else sessionStorage.removeItem('ep_admin_site');
        checkState();
    } catch {
        loginError.textContent = 'Login failed. Check connection.';
    }
};

function checkState() {
    if (sessionStorage.getItem('ep_admin') === 'true' && adminToken) {
        loginScreen.style.display = 'none';
        dashboard.style.display = 'block';

        // Show/hide site filter based on admin type
        const siteFilterWrap = document.getElementById('siteFilterWrap');
        if (siteFilterWrap) siteFilterWrap.style.display = isSuperAdmin() ? '' : 'none';

        // Show site badge for site-restricted admins
        const siteBadge = document.getElementById('adminSiteBadge');
        if (siteBadge) {
            const site = getAdminSite();
            siteBadge.textContent = site ? `Site: ${site}` : '';
            siteBadge.style.display = site ? 'inline-flex' : 'none';
        }

        const savedTab = sessionStorage.getItem('ep_admin_tab') || 'dashboard';
        const tabBtn = document.querySelector(`.tab-btn[data-tab="${savedTab}"]`);
        if (tabBtn) tabBtn.click();
        else loadDashboard();
    } else {
        // Clear stale session without token
        sessionStorage.removeItem('ep_admin');
        sessionStorage.removeItem('ep_admin_tab');
        loginScreen.style.display = 'flex';
        dashboard.style.display = 'none';
    }
}

function getAdminSite() { return sessionStorage.getItem('ep_admin_site') || null; }
function isSuperAdmin() { return !getAdminSite(); }

document.getElementById('btnAdminLogout').onclick = () => {
    sessionStorage.removeItem('ep_admin');
    sessionStorage.removeItem('ep_admin_tab');
    sessionStorage.removeItem('ep_admin_token');
    sessionStorage.removeItem('ep_admin_site');
    adminToken = null;
    window.location.reload();
};

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
        const tabName = btn.dataset.tab;
        sessionStorage.setItem('ep_admin_tab', tabName);
        document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
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

function getRetentionCutoff() {
    const retention = localStorage.getItem('ep_retention') || '1m';
    if (retention === 'all') return null;
    const d = new Date();
    if (retention === '1d') d.setDate(d.getDate() - 1);
    else if (retention === '1w') d.setDate(d.getDate() - 7);
    else if (retention === '1m') d.setMonth(d.getMonth() - 1);
    else if (retention === '1y') d.setFullYear(d.getFullYear() - 1);
    else if (retention.startsWith('custom_')) {
        const days = parseInt(retention.split('_')[1]);
        if (days > 0) d.setDate(d.getDate() - days);
        else return null;
    }
    return d.toISOString().split('T')[0];
}

let _dashData = null;
let _activePeriod = 'day';

async function loadDashboard() {
    _contractorSiteFilter = null;
    _siteStatsCache = {};
    try {
        const cutoff = getRetentionCutoff();
        const url = cutoff ? `${API}/api/stats?from=${cutoff}` : `${API}/api/stats`;
        const resp = await fetch(url, { headers: adminHeaders() });
        if (handleAuthError(resp)) return;
        if (!resp.ok) { console.error('Stats fetch failed:', resp.status); return; }
        _dashData = await resp.json();

        // Retention badge
        const retention = localStorage.getItem('ep_retention') || '1m';
        const retLabels = { '1d': '1 Day', '1w': '1 Week', '1m': '1 Month', '1y': '1 Year', 'all': 'All Time' };
        const retLabel = retLabels[retention] || (retention.startsWith('custom_') ? `Last ${retention.split('_')[1]} Days` : '1 Month');
        const badge = document.getElementById('retentionBadge');
        if (badge) badge.textContent = `Showing: ${retLabel}`;

        // Period tab wiring (only wire once, guard with flag)
        if (!loadDashboard._wired) {
            loadDashboard._wired = true;
            const periodSelect = document.getElementById('dashPeriodSelect');
            periodSelect.onchange = () => {
                _activePeriod = periodSelect.value;
                const datePicker = document.getElementById('dashDatePicker');
                const monthPicker = document.getElementById('dashMonthPicker');
                if (_activePeriod === 'date') {
                    datePicker.style.display = '';
                    monthPicker.style.display = 'none';
                    if (!datePicker.value) {
                        const t = new Date();
                        // Use local date parts to avoid UTC offset shifting the day
                        datePicker.value = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
                    }
                } else if (_activePeriod === 'pickmonth') {
                    datePicker.style.display = 'none';
                    monthPicker.style.display = '';
                    if (!monthPicker.value) {
                        const t = new Date();
                        monthPicker.value = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}`;
                    }
                } else {
                    datePicker.style.display = 'none';
                    monthPicker.style.display = 'none';
                }
                renderDashPeriod();
            };
            document.getElementById('dashDatePicker').onchange = () => renderDashPeriod();
            document.getElementById('dashMonthPicker').onchange = () => renderDashPeriod();
        }

        renderDashStats();
        renderDashPeriod();

        // Site chart: super admin only
        const siteChartCard = document.getElementById('siteChartCard');
        const dashChartGrid = document.getElementById('dashChartGrid');
        if (isSuperAdmin()) {
            if (siteChartCard) siteChartCard.style.display = '';
            if (dashChartGrid) dashChartGrid.classList.remove('chart-grid--single');
            renderHorizontalChart('siteChartArea', _dashData.bySite || {}, 'siteChartSubtitle');
            buildContractorSiteFilter(_dashData.bySite || {});
        } else {
            if (siteChartCard) siteChartCard.style.display = 'none';
            if (dashChartGrid) dashChartGrid.classList.add('chart-grid--single');
        }
        renderHorizontalChart('contractorChartArea', _dashData.byContractor || {}, 'contractorChartSubtitle');

        // Donut charts
        renderDonutChart('designationChartArea', _dashData.byDesignation || {}, 'designationChartSubtitle');
        renderDonutChart('ageChartArea', _dashData.byAgeGroup || {}, 'ageChartSubtitle', { 'Other': Object.entries(_dashData.ageOtherBreakdown || {}) });
        renderDonutChart('stateChartArea', _dashData.byState || {}, 'stateChartSubtitle');
        renderDonutChart('districtChartArea', _dashData.byDistrict || {}, 'districtChartSubtitle');

        // Per-site drill-down filters for the donut charts (super admin only)
        if (isSuperAdmin()) {
            buildChartSiteFilter('designationSiteFilter', _dashData.bySite || {}, (data) =>
                renderDonutChart('designationChartArea', data.byDesignation || {}, 'designationChartSubtitle'));
            buildChartSiteFilter('ageSiteFilter', _dashData.bySite || {}, (data) =>
                renderDonutChart('ageChartArea', data.byAgeGroup || {}, 'ageChartSubtitle', { 'Other': Object.entries(data.ageOtherBreakdown || {}) }));
            buildChartSiteFilter('stateSiteFilter', _dashData.bySite || {}, (data) =>
                renderDonutChart('stateChartArea', data.byState || {}, 'stateChartSubtitle'));
            buildChartSiteFilter('districtSiteFilter', _dashData.bySite || {}, (data) =>
                renderDonutChart('districtChartArea', data.byDistrict || {}, 'districtChartSubtitle'));
        }

    } catch (err) { console.error('Dashboard load failed:', err); }
}

function renderDashStats() {
    if (!_dashData) return;
    animateCounter(document.getElementById('statTotal'), _dashData.total || 0);

    // Site count grid inside stat card — super admin only
    const siteCountGrid = document.getElementById('siteCountGrid');
    if (siteCountGrid && isSuperAdmin()) {
        document.getElementById('siteCountCard').style.display = '';
        renderSiteCountGrid(_dashData.bySite || {});
    } else if (siteCountGrid) {
        document.getElementById('siteCountCard').style.display = 'none';
    }
}

function renderSiteCountGrid(bySite) {
    const siteCountGrid = document.getElementById('siteCountGrid');
    if (!siteCountGrid) return;
    const entries = Object.entries(bySite).sort((a, b) => b[1] - a[1]);
    const siteCountTotal = document.getElementById('siteCountTotal');
    const siteCountSublabel = document.getElementById('siteCountSublabel');
    if (siteCountTotal) siteCountTotal.textContent = String(entries.length);
    if (siteCountSublabel) {
        siteCountSublabel.textContent = entries.length
            ? `${entries.length} site${entries.length === 1 ? '' : 's'} with records`
            : 'No site activity yet';
    }
    if (entries.length) {
        siteCountGrid.innerHTML = entries.map(([site, count]) => `
            <div class="site-count-pill" title="${esc(site)}">
                <span class="site-count-name">${esc(site)}</span>
                <span class="site-count-num" id="siteCount-${esc(site)}">${count}</span>
            </div>`).join('');
    } else {
        siteCountGrid.innerHTML = '<p class="site-count-empty">No data</p>';
    }
}

let _contractorSiteFilter = null; // null = all sites

function buildContractorSiteFilter(bySite) {
    const wrap = document.getElementById('contractorSiteFilter');
    if (!wrap) return;
    const sites = Object.keys(bySite).sort();
    if (sites.length < 2) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'flex';
    const render = () => {
        wrap.innerHTML = [null, ...sites].map(s => {
            const active = _contractorSiteFilter === s;
            const label = s === null ? 'All' : s;
            return `<button type="button"
                style="padding:0.22rem 0.65rem;border-radius:20px;font-size:0.68rem;font-weight:700;font-family:inherit;cursor:pointer;border:1.5px solid ${active ? 'var(--primary)' : 'var(--border)'};background:${active ? 'var(--primary)' : '#fff'};color:${active ? '#fff' : 'var(--text-light)'};transition:all 0.15s;"
                onclick="selectContractorSite(${s === null ? 'null' : `'${s}'`})">${esc(label)}</button>`;
        }).join('');
    };
    render();
    wrap._render = render;
}

async function selectContractorSite(site) {
    _contractorSiteFilter = site;
    const wrap = document.getElementById('contractorSiteFilter');
    if (wrap && wrap._render) wrap._render();
    if (!site) {
        renderHorizontalChart('contractorChartArea', _dashData.byContractor || {}, 'contractorChartSubtitle');
        document.getElementById('contractorChartSubtitle').textContent = 'All records';
        return;
    }
    document.getElementById('contractorChartSubtitle').textContent = 'Loading…';
    try {
        const data = await fetchSiteStats(site);
        if (!data) return;
        renderHorizontalChart('contractorChartArea', data.byContractor || {}, 'contractorChartSubtitle');
        document.getElementById('contractorChartSubtitle').textContent = `${site} — ${data.total || 0} records`;
    } catch (e) { console.error(e); }
}

// Fetch /api/stats scoped to one site (respecting retention), cached per site so multiple
// charts drilling into the same site share a single request.
let _siteStatsCache = {};
async function fetchSiteStats(site) {
    if (_siteStatsCache[site]) return _siteStatsCache[site];
    const cutoff = getRetentionCutoff();
    const params = new URLSearchParams({ site });
    if (cutoff) params.set('from', cutoff);
    const resp = await fetch(`${API}/api/stats?${params}`, { headers: adminHeaders() });
    if (handleAuthError(resp)) return null;
    if (!resp.ok) return null;
    const data = await resp.json();
    _siteStatsCache[site] = data;
    return data;
}

// Generic per-chart site filter. Renders an "All / <site>" pill row and, on click,
// re-renders the chart from either the global dashboard data or site-scoped stats.
// renderFn(data, site) is called with the correct dataset each time.
function buildChartSiteFilter(wrapId, bySite, renderFn) {
    const wrap = document.getElementById(wrapId);
    if (!wrap) return;
    const sites = Object.keys(bySite).sort();
    if (sites.length < 2) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'flex';
    wrap.style.gap = '0.4rem';
    wrap.style.flexWrap = 'wrap';
    let active = null;
    const render = () => {
        wrap.innerHTML = [null, ...sites].map(s => {
            const on = active === s;
            const label = s === null ? 'All' : s;
            return `<button type="button"
                style="padding:0.22rem 0.65rem;border-radius:20px;font-size:0.68rem;font-weight:700;font-family:inherit;cursor:pointer;border:1.5px solid ${on ? 'var(--primary)' : 'var(--border)'};background:${on ? 'var(--primary)' : '#fff'};color:${on ? '#fff' : 'var(--text-light)'};transition:all 0.15s;"
                data-site="${s === null ? '' : esc(s)}">${esc(label)}</button>`;
        }).join('');
        wrap.querySelectorAll('button').forEach(btn => {
            btn.onclick = async () => {
                const s = btn.getAttribute('data-site') || null;
                active = s;
                render();
                if (!s) { renderFn(_dashData, null); return; }
                const data = await fetchSiteStats(s);
                if (data) renderFn(data, s);
            };
        });
    };
    render();
}

async function renderDashPeriod() {
    if (!_dashData) return;
    const now = new Date();
    const dateOpt = { day: 'numeric', month: 'short' };

    if (_activePeriod === 'date') {
        const picker = document.getElementById('dashDatePicker');
        const picked = picker.value; // YYYY-MM-DD string, already timezone-safe
        if (!picked) {
            document.getElementById('labelPeriod').textContent = 'Selected Date';
            document.getElementById('labelPeriodSub').textContent = 'Pick a date above';
            document.getElementById('statPeriod').textContent = '—';
            return;
        }
        // Build next day string without any Date object to avoid UTC shift
        const [y, m, d] = picked.split('-').map(Number);
        const nextDay = d + 1;
        let toY = y, toM = m, toD = nextDay;
        const daysInMonth = new Date(y, m, 0).getDate();
        if (nextDay > daysInMonth) { toD = 1; toM = m + 1; if (toM > 12) { toM = 1; toY = y + 1; } }
        const toStr = `${toY}-${String(toM).padStart(2,'0')}-${String(toD).padStart(2,'0')}`;
        const cutoff = getRetentionCutoff();
        const base = cutoff && cutoff > picked ? cutoff : picked;
        try {
            const resp = await fetch(`${API}/api/stats?from=${base}&to=${toStr}`, { headers: adminHeaders() });
            if (!resp.ok) return;
            const data = await resp.json();
            const [py, pm, pd] = picked.split('-').map(Number);
            const label = new Date(py, pm - 1, pd).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
            document.getElementById('labelPeriod').textContent = 'Selected Date';
            document.getElementById('labelPeriodSub').textContent = label;
            animateCounter(document.getElementById('statPeriod'), data.total || 0);
            if (isSuperAdmin()) renderSiteCountGrid(data.bySite || {});
        } catch (e) { console.error(e); }
        return;
    }

    if (_activePeriod === 'pickmonth') {
        const picker = document.getElementById('dashMonthPicker');
        const picked = picker.value; // YYYY-MM string
        if (!picked) {
            document.getElementById('labelPeriod').textContent = 'Selected Month';
            document.getElementById('labelPeriodSub').textContent = 'Pick a month above';
            document.getElementById('statPeriod').textContent = '—';
            return;
        }
        const [y, m] = picked.split('-').map(Number);
        // First day of selected month, first day of next month — pure string math, no UTC shift
        const fromStr = `${y}-${String(m).padStart(2,'0')}-01`;
        const nextM = m === 12 ? 1 : m + 1;
        const nextY = m === 12 ? y + 1 : y;
        const toStr = `${nextY}-${String(nextM).padStart(2,'0')}-01`;
        const cutoff = getRetentionCutoff();
        const base = cutoff && cutoff > fromStr ? cutoff : fromStr;
        try {
            const resp = await fetch(`${API}/api/stats?from=${base}&to=${toStr}`, { headers: adminHeaders() });
            if (!resp.ok) return;
            const data = await resp.json();
            const label = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            document.getElementById('labelPeriod').textContent = 'Selected Month';
            document.getElementById('labelPeriodSub').textContent = label;
            animateCounter(document.getElementById('statPeriod'), data.total || 0);
            if (isSuperAdmin()) renderSiteCountGrid(data.bySite || {});
        } catch (e) { console.error(e); }
        return;
    }

    let value, periodLabel, subLabel;
    if (_activePeriod === 'day') {
        value = _dashData.today || 0;
        periodLabel = 'Today';
        subLabel = now.toLocaleDateString('en-US', dateOpt);
    } else if (_activePeriod === 'week') {
        value = _dashData.week || 0;
        periodLabel = 'This Week';
        const first = now.getDate() - now.getDay();
        const d0 = new Date(now.getFullYear(), now.getMonth(), first);
        const d1 = new Date(now.getFullYear(), now.getMonth(), first + 6);
        subLabel = `${d0.toLocaleDateString('en-US', dateOpt)} – ${d1.toLocaleDateString('en-US', dateOpt)}`;
    } else {
        value = _dashData.month || 0;
        periodLabel = 'This Month';
        subLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }

    document.getElementById('labelPeriod').textContent = periodLabel;
    document.getElementById('labelPeriodSub').textContent = subLabel;
    animateCounter(document.getElementById('statPeriod'), value);
    if (isSuperAdmin()) renderSiteCountGrid(_dashData.bySite || {});
}

const CHART_COLORS = ['#1a3c6e', '#10b981', '#6366f1', '#f59e0b', '#ef4444', '#8b5cf6', '#c8a45a', '#ec4899'];
const CHART_BG = ['#eef4ff', '#ecfdf5', '#eef2ff', '#fffbeb', '#fef2f2', '#f5f3ff', '#fdf8ee', '#fdf2f8'];

function renderHorizontalChart(containerId, dataObj, subtitleId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let entries = Object.entries(dataObj).sort((a, b) => b[1] - a[1]);
    const MAX_SHOW = 8;
    let othersCount = 0;
    let othersBreakdown = [];
    if (entries.length > MAX_SHOW) {
        const rest = entries.slice(MAX_SHOW);
        othersCount = rest.reduce((s, e) => s + e[1], 0);
        othersBreakdown = rest;
        entries = entries.slice(0, MAX_SHOW);
    }
    if (othersCount > 0) entries.push(['Others', othersCount]);

    if (entries.length === 0) {
        container.innerHTML = '<div class="hchart-empty">No data available for this period</div>';
        if (subtitleId) document.getElementById(subtitleId).textContent = '0 records';
        return;
    }

    const total = entries.reduce((s, e) => s + e[1], 0);
    const maxVal = Math.max(...entries.map(e => e[1]), 1);
    if (subtitleId) {
        const el = document.getElementById(subtitleId);
        if (el) el.textContent = `${total} total pass${total !== 1 ? 'es' : ''}`;
    }

    container.innerHTML = `<div class="hchart">${entries.map(([label, value], i) => {
        const pct = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
        const barPct = maxVal > 0 ? ((value / maxVal) * 100).toFixed(1) : 0;
        const color = CHART_COLORS[i % CHART_COLORS.length];
        const bg = CHART_BG[i % CHART_BG.length];
        const isOthers = label === 'Others' && othersBreakdown.length > 0;
        return `
        <div class="hchart-row${isOthers ? ' hchart-row--others' : ''}"${isOthers ? ` onclick='showOthersBreakdown(${JSON.stringify(othersBreakdown)})' title="Click to see what's in Others"` : ''}>
            <div class="hchart-label" title="${esc(label)}">${esc(label)}</div>
            <div class="hchart-track">
                <div class="hchart-fill" style="width:${barPct}%; background:${color};" data-val="${value}"></div>
            </div>
            <div class="hchart-meta">
                <span class="hchart-count" style="color:${color};">${value}</span>
                <span class="hchart-pct" style="background:${bg}; color:${color};">${pct}%</span>
            </div>
        </div>`;
    }).join('')}</div>`;

    // Animate bars in
    requestAnimationFrame(() => {
        container.querySelectorAll('.hchart-fill').forEach((el, i) => {
            el.style.width = '0%';
            setTimeout(() => {
                el.style.transition = `width 0.55s cubic-bezier(0.4,0,0.2,1) ${i * 60}ms`;
                el.style.width = el.dataset.val / maxVal * 100 + '%';
            }, 30);
        });
    });
}

// Show a breakdown of what's grouped into an "Others" bucket in a chart.
function showOthersBreakdown(entries) {
    const sorted = [...entries].sort((a, b) => b[1] - a[1]);
    const total = sorted.reduce((s, e) => s + e[1], 0);
    const subtitle = document.getElementById('othersModalSubtitle');
    if (subtitle) subtitle.textContent = `${sorted.length} item${sorted.length !== 1 ? 's' : ''} · ${total} pass${total !== 1 ? 'es' : ''} grouped together`;

    const list = document.getElementById('othersModalList');
    if (list) {
        list.innerHTML = sorted.map(([label, value], i) => `
            <div class="others-item">
                <span class="others-item-dot" style="background:${CHART_COLORS[i % CHART_COLORS.length]};"></span>
                <span class="others-item-label" title="${esc(label)}">${esc(label)}</span>
                <span class="others-item-count">${value}</span>
            </div>`).join('');
    }
    document.getElementById('othersModal').style.display = 'flex';
}

document.getElementById('closeOthersModal').onclick = () => {
    document.getElementById('othersModal').style.display = 'none';
};

// ─── DONUT CHART (designation, age group) ──────────────────────────
// knownBreakdowns: optional map of label -> [[subLabel, count], ...] for slices whose
// composition is already known server-side (e.g. the age "Other" bucket), so clicking
// them shows real data instead of only the client-computed top-N overflow.
function renderDonutChart(containerId, dataObj, subtitleId, knownBreakdowns) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let entries = Object.entries(dataObj).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const MAX_SHOW = 7;
    const breakdowns = { ...(knownBreakdowns || {}) };
    if (entries.length > MAX_SHOW) {
        const rest = entries.slice(MAX_SHOW);
        const othersCount = rest.reduce((s, e) => s + e[1], 0);
        breakdowns['Others'] = rest;
        entries = entries.slice(0, MAX_SHOW);
        if (othersCount > 0) entries.push(['Others', othersCount]);
    }

    const total = entries.reduce((s, e) => s + e[1], 0);
    if (subtitleId) {
        const el = document.getElementById(subtitleId);
        if (el) el.textContent = `${total} total pass${total !== 1 ? 'es' : ''}`;
    }

    if (total === 0) {
        container.innerHTML = '<div class="hchart-empty">No data available for this period</div>';
        return;
    }

    // Build SVG donut using stroke-dasharray segments on concentric circle arcs.
    const R = 60, C = 2 * Math.PI * R, CX = 80, CY = 80, SW = 26;
    let offset = 0;
    const segments = entries.map(([, value], i) => {
        const frac = value / total;
        const dash = frac * C;
        const color = CHART_COLORS[i % CHART_COLORS.length];
        const seg = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${color}" stroke-width="${SW}"
            stroke-dasharray="${dash.toFixed(2)} ${(C - dash).toFixed(2)}"
            stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${CX} ${CY})"
            style="transition:stroke-dasharray 0.6s cubic-bezier(0.4,0,0.2,1);"></circle>`;
        offset += dash;
        return seg;
    }).join('');

    const legend = entries.map(([label, value], i) => {
        const pct = ((value / total) * 100).toFixed(1);
        const color = CHART_COLORS[i % CHART_COLORS.length];
        const breakdown = breakdowns[label];
        const isClickable = breakdown && breakdown.length > 0;
        return `<div class="donut-legend-row${isClickable ? ' donut-legend-row--others' : ''}"${isClickable ? ` onclick='showOthersBreakdown(${JSON.stringify(breakdown)})' title="Click to see what's in ${esc(label)}"` : ''}>
            <span class="donut-legend-dot" style="background:${color};"></span>
            <span class="donut-legend-label" title="${esc(label)}">${esc(label)}</span>
            <span class="donut-legend-count">${value}</span>
            <span class="donut-legend-pct">${pct}%</span>
        </div>`;
    }).join('');

    container.innerHTML = `<div class="donut-wrap">
        <div class="donut-svg-wrap">
            <svg viewBox="0 0 160 160" width="150" height="150">${segments}</svg>
            <div class="donut-center"><span class="donut-center-num">${total}</span><span class="donut-center-lbl">total</span></div>
        </div>
        <div class="donut-legend">${legend}</div>
    </div>`;
}

// ------ RECORDS ------
let currentRecords = [];
let currentSortedRecords = [];
let currentPage = 1;
const RECORDS_PER_PAGE = 7;

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
    currentSortedRecords = sorted;
    const totalPages = Math.max(1, Math.ceil(sorted.length / RECORDS_PER_PAGE));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    renderRecordsPage();
}

function renderRecordsPage() {
    const totalPages = Math.max(1, Math.ceil(currentSortedRecords.length / RECORDS_PER_PAGE));
    const start = (currentPage - 1) * RECORDS_PER_PAGE;
    const pageRecords = currentSortedRecords.slice(start, start + RECORDS_PER_PAGE);
    renderRecordsTable(pageRecords);
    renderPaginationControls(totalPages);
}

function goToRecordsPage(page) {
    const totalPages = Math.max(1, Math.ceil(currentSortedRecords.length / RECORDS_PER_PAGE));
    currentPage = Math.min(Math.max(1, page), totalPages);
    renderRecordsPage();
    document.getElementById('recordsTable')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderPaginationControls(totalPages) {
    const wrap = document.getElementById('recordsPagination');
    const info = document.getElementById('recordsPaginationInfo');
    const controls = document.getElementById('recordsPaginationControls');
    if (!wrap || !info || !controls) return;

    const total = currentSortedRecords.length;
    if (total === 0) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'flex';

    const start = (currentPage - 1) * RECORDS_PER_PAGE + 1;
    const end = Math.min(currentPage * RECORDS_PER_PAGE, total);
    info.textContent = `Showing ${start}–${end} of ${total} records`;

    // Compact page-number list: first, last, current ±1, with ellipses for gaps.
    const pages = [];
    for (let p = 1; p <= totalPages; p++) {
        if (p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1) pages.push(p);
        else if (pages[pages.length - 1] !== '…') pages.push('…');
    }

    const btn = (label, page, opts = {}) => `<button type="button" class="pg-btn${opts.active ? ' pg-btn--active' : ''}"
        ${opts.disabled ? 'disabled' : ''} ${page !== undefined ? `data-page="${page}"` : ''}>${label}</button>`;

    let html = '';
    html += btn('&laquo;', currentPage - 1, { disabled: currentPage === 1 });
    pages.forEach(p => {
        html += p === '…' ? '<span class="pg-ellipsis">…</span>' : btn(p, p, { active: p === currentPage });
    });
    html += btn('&raquo;', currentPage + 1, { disabled: currentPage === totalPages });

    controls.innerHTML = html;
    controls.querySelectorAll('.pg-btn[data-page]').forEach(b => {
        b.onclick = () => goToRecordsPage(parseInt(b.getAttribute('data-page')));
    });
}

function renderRecordsTable(records) {
    const tbody = document.getElementById('recordsBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="24" style="text-align:center; padding:2rem; color:var(--text-light);">No records found</td></tr>';
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
            <td class="record-photo-cell">${photoSrc ? `<img src="${esc(photoSrc)}" class="record-photo" alt="Photo" />` : '<span class="record-photo-empty">N/A</span>'}</td>
            <td class="record-name-cell"><span class="record-name">${esc(r.fullName) || '---'}</span><span class="record-subtext">${esc(r.contact) || 'No contact'}</span></td>
            <td class="record-mono">${esc(r.aadhar) || '---'}</td>
            <td class="record-age">${esc(r.age) || '---'}</td>
            <td><span class="record-pill record-pill--gender">${esc(r.gender) || '---'}</span></td>
            <td class="record-muted">${esc(formatDate(r.dob))}</td>
            <td><span class="record-pill record-pill--blood">${esc(r.bloodGroup) || '---'}</span></td>
            <td class="record-muted">${esc(r.state) || '---'}</td>
            <td class="record-muted">${esc(r.district) || '---'}</td>
            <td class="record-muted">${esc(r.address) || '---'}</td>
            <td class="record-strong">${esc(r.contractor) || '---'}</td>
            <td><span class="record-pill record-pill--camp">${esc(r.laborCamp) || '---'}</span></td>
            <td class="record-muted">${esc(r.subContractor) || '---'}</td>
            <td class="record-mono">${esc(r.subContractorContact) || '---'}</td>
            <td><span class="record-pill record-pill--designation">${esc(r.designation) || '---'}</span></td>
            <td class="record-mono">${esc(r.contact) || '---'}</td>
            <td><span class="record-pill record-pill--site">${esc(r.site) || 'EMPTY'}</span></td>
            <td class="record-muted">${esc(r.operator) || 'EMPTY'}</td>
            <td class="record-muted">${esc(formatDate(r.doi))}</td>
            <td class="record-muted">${esc(formatDate(r.validity))}</td>
            <td class="record-muted">${esc(formatDate(r.issueDate))}</td>
            <td class="record-muted">${esc(String(r.reissueCount != null ? r.reissueCount : 0))}</td>
            <td class="record-muted">${esc(r.aadharVerified) || 'No'}</td>
            <td class="record-created">${formatDateTime(r.createdAt)}</td>
            <td class="record-actions-cell"><button class="btn-delete" onclick="deleteRecord('${esc(r._id)}')">Delete</button></td>`;
        tbody.appendChild(tr);
    });
}

// Build the shared filter query params used by both the records table and the CSV export,
// so a download always reflects exactly what the current filters select.
function buildRecordsParams(from, to) {
    const params = [];
    if (!from && !to) {
        const cutoff = getRetentionCutoff();
        if (cutoff) from = cutoff;
    }
    if (from) params.push(`from=${from}`);
    if (to) params.push(`to=${to}`);
    // Super admin: pass selected site filter; site admin: server enforces their site automatically
    if (isSuperAdmin()) {
        const selSite = document.getElementById('filterSite');
        if (selSite && selSite.value) params.push(`site=${encodeURIComponent(selSite.value)}`);
    }
    return params;
}

// Page through /api/employees to collect EVERY record matching the current filters.
// A single page fetch caps at the server's limit (200 default / 500 max), which would
// otherwise silently truncate the table, sort, and exports to the first page.
async function fetchAllRecords(from, to) {
    const base = buildRecordsParams(from, to);
    const PAGE_SIZE = 500; // server clamps limit to 500
    const all = [];
    let page = 1;
    let pages = 1;
    do {
        const params = base.concat([`page=${page}`, `limit=${PAGE_SIZE}`]);
        const resp = await fetch(`${API}/api/employees?${params.join('&')}`, { headers: adminHeaders() });
        if (handleAuthError(resp)) return null;
        if (!resp.ok) throw new Error(`Records fetch failed: ${resp.status}`);
        const result = await resp.json();
        const chunk = result.data || result;
        all.push(...chunk);
        pages = result.pages || 1;
        page++;
    } while (page <= pages);
    return all;
}

async function loadRecords(from, to, opts = {}) {
    // Capture the site filter that is actually being applied to THIS fetch, before the
    // await — if the admin changes the dropdown while the request is in flight, the badge
    // must still reflect what was queried, not whatever the dropdown shows when it resolves.
    const appliedSite = isSuperAdmin() ? (document.getElementById('filterSite')?.value || '') : getAdminSite();
    try {
        const records = await fetchAllRecords(from, to);
        if (records === null) return; // auth error already handled
        currentRecords = records;
        if (!opts.preservePage) currentPage = 1;
        sortAndRenderRecords();
        const badge = document.getElementById('recordsCountBadge');
        if (badge) {
            const total = currentRecords.length;
            const siteLabel = appliedSite ? ` · ${appliedSite}` : '';
            badge.textContent = `${total} ${total === 1 ? 'record' : 'records'}${siteLabel}`;
            badge.style.display = '';
        }
    } catch (err) { console.error('Records load failed:', err); }
}

async function deleteRecord(id) {
    const confirmed = await showConfirm('Delete this record permanently? This action cannot be undone.');
    if (!confirmed) return;
    try {
        const resp = await fetch(`${API}/api/employees/${id}`, { method: 'DELETE', headers: adminHeaders() });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            return showAlert(err.error || 'Delete failed. Please try again.');
        }
        showAlert('Record deleted successfully.');
        loadRecords(document.getElementById('filterFrom').value, document.getElementById('filterTo').value, { preservePage: true });
    } catch (err) { console.error('Delete failed:', err); showAlert('Network error. Please try again.'); }
}

document.getElementById('btnApplyFilter').onclick = () => loadRecords(document.getElementById('filterFrom').value, document.getElementById('filterTo').value);
document.getElementById('filterSite').onchange = () => loadRecords(document.getElementById('filterFrom').value, document.getElementById('filterTo').value);
document.getElementById('btnResetFilter').onclick = () => {
    document.getElementById('filterFrom').value = '';
    document.getElementById('filterTo').value = '';
    document.getElementById('sortRecords').value = 'latest';
    const selSite = document.getElementById('filterSite');
    if (selSite) selSite.value = '';
    loadRecords();
};
document.getElementById('sortRecords').onchange = () => { currentPage = 1; sortAndRenderRecords(); };
// Admin export dropdown
(function() {
    const menu = document.getElementById('adminExportMenu');
    const trigger = document.getElementById('btnAdminExport');

    trigger.onclick = (e) => {
        e.stopPropagation();
        menu.classList.toggle('export-dropdown-menu--open');
    };
    document.addEventListener('click', () => menu.classList.remove('export-dropdown-menu--open'));

    function x(v) { return (v || '---').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').trim(); }

    function fmtTime(d) {
        if (!d) return '---';
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return '---';
        let h = dt.getHours();
        const m = String(dt.getMinutes()).padStart(2,'0');
        const ap = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        return `${h}:${m} ${ap}`;
    }

    function getPhotoUrl(r) {
        if (!r.photoPath) return '';
        const p = r.photoPath.replace(/\\/g, '/');
        return r.photoPath.startsWith('http') ? r.photoPath : `${API}/${p.startsWith('/') ? p.slice(1) : p}`;
    }

    function buildXLS(withPhoto, records) {
        const headers = withPhoto
            ? ['Photo URL','Name','Aadhar','Age','Gender','DOB','Blood Group','State','District','Address','Contractor','Labor Camp','Thekedar','Thekedar Contact','Designation','Contact','Site','Operator','DOI','Validity','Issue Date','Reissue Count','Aadhar Verified','Created At']
            : ['Name','Aadhar','Age','Gender','DOB','Blood Group','State','District','Address','Contractor','Labor Camp','Thekedar','Thekedar Contact','Designation','Contact','Site','Operator','DOI','Validity','Issue Date','Reissue Count','Aadhar Verified','Created At'];

        const rows = records.map(r => {
            const row = {};
            if (withPhoto) row['Photo URL'] = getPhotoUrl(r) || '---';
            row['Name']         = r.fullName  || '---';
            row['Aadhar']       = String(r.aadhar  || '---');
            row['Age']          = r.age        || '---';
            row['Gender']       = r.gender     || '---';
            row['DOB']          = formatDate(r.dob);
            row['Blood Group']  = r.bloodGroup || '---';
            row['State']        = r.state      || '---';
            row['District']     = r.district   || '---';
            row['Address']      = r.address    || '---';
            row['Contractor']   = r.contractor || '---';
            row['Labor Camp']   = r.laborCamp  || '---';
            row['Thekedar'] = r.subContractor || '---';
            row['Thekedar Contact'] = r.subContractorContact || '---';
            row['Designation']  = r.designation|| '---';
            row['Contact']      = String(r.contact || '---');
            row['Site']         = r.site       || '---';
            row['Operator']     = r.operator   || '---';
            row['DOI']          = formatDate(r.doi);
            row['Validity']     = formatDate(r.validity);
            row['Issue Date']   = formatDate(r.issueDate);
            row['Reissue Count'] = r.reissueCount != null ? r.reissueCount : 0;
            row['Aadhar Verified'] = r.aadharVerified || 'No';
            row['Created At']   = fmtTime(r.createdAt);
            return row;
        });

        return { headers, rows };
    }

    function getDateStr() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    function exportCleanXLSX(filename, records) {
        // Without photos — real .xlsx via SheetJS, no warnings
        const { headers, rows } = buildXLS(false, records);
        const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
        ws['!cols'] = headers.map(h => {
            if (h === 'Name' || h === 'Contractor') return { wch: 22 };
            if (h === 'Aadhar' || h === 'Contact')  return { wch: 16 };
            if (h === 'Labor Camp' || h === 'Designation') return { wch: 18 };
            return { wch: 12 };
        });
        rows.forEach((_, i) => {
            ['Aadhar','Contact'].forEach(field => {
                const ci = headers.indexOf(field);
                if (ci < 0) return;
                const ca = XLSX.utils.encode_cell({ r: i + 1, c: ci });
                if (ws[ca]) ws[ca].t = 's';
            });
        });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Records');
        XLSX.writeFile(wb, filename);
    }

    async function exportWithPhotosHTML(filename, records) {
        // With photos — fetch images via server proxy, embed as base64 in a self-contained HTML report
        const btn = document.getElementById('btnAdminExportWithPhoto');
        const origText = btn.textContent;
        btn.textContent = 'Preparing…';
        btn.disabled = true;

        const cols = ['Photo','Name','Aadhar','Age','Gender','DOB','Blood Group','State','District','Address','Contractor','Labor Camp','Thekedar','Thekedar Contact','Designation','Contact','Site','Operator','DOI','Validity','Issue Date','Reissue Count','Aadhar Verified','Created At'];
        const thS = 'background:#1a3c6e;color:#fff;font-weight:700;padding:8px 10px;font-size:11px;text-align:left;border:1px solid #0d2240;white-space:nowrap;';
        const header = cols.map(c => `<th style="${thS}">${c}</th>`).join('');

        async function fetchB64(url) {
            if (!url) return null;
            try {
                const r = await fetch(`${API}/api/imgproxy?url=${encodeURIComponent(url)}`, { headers: adminHeaders() });
                if (!r.ok) return null;
                const j = await r.json();
                return j.b64 ? `data:${j.ct};base64,${j.b64}` : null;
            } catch { return null; }
        }

        // Fetch photos in small concurrent batches — firing all requests at once for large
        // record sets blows past the server's per-IP rate limit and fails the whole export.
        const PHOTO_BATCH_SIZE = 8;
        const dataRows = [];
        for (let start = 0; start < records.length; start += PHOTO_BATCH_SIZE) {
            const batch = records.slice(start, start + PHOTO_BATCH_SIZE);
            btn.textContent = `Preparing… (${Math.min(start + PHOTO_BATCH_SIZE, records.length)}/${records.length})`;
            const batchRows = await Promise.all(batch.map(async (r, bi) => {
                const i = start + bi;
                const bg = i % 2 === 0 ? '#fff' : '#f8fafc';
                const td = v => `<td style="padding:5px 9px;border:1px solid #e2e8f0;vertical-align:middle;font-size:10px;background:${bg};">${v||'---'}</td>`;
                const b64 = await fetchB64(getPhotoUrl(r));
                const imgCell = `<td style="padding:3px;border:1px solid #e2e8f0;text-align:center;vertical-align:middle;background:${bg};">${b64 ? `<img src="${b64}" width="48" height="48" style="border-radius:4px;display:block;" />` : '—'}</td>`;
                return `<tr>
                    ${imgCell}
                    ${td(x(r.fullName))}
                    ${td(r.aadhar)}
                    ${td(r.age)}
                    ${td(x(r.gender))}
                    ${td(formatDate(r.dob))}
                    ${td(x(r.bloodGroup))}
                    ${td(x(r.state))}
                    ${td(x(r.district))}
                    ${td(x(r.address))}
                    ${td(x(r.contractor))}
                    ${td(x(r.laborCamp))}
                    ${td(x(r.subContractor))}
                    ${td(r.subContractorContact)}
                    ${td(x(r.designation))}
                    ${td(r.contact)}
                    ${td(x(r.site))}
                    ${td(x(r.operator))}
                    ${td(formatDate(r.doi))}
                    ${td(formatDate(r.validity))}
                    ${td(formatDate(r.issueDate))}
                    ${td(String(r.reissueCount != null ? r.reissueCount : 0))}
                    ${td(x(r.aadharVerified || 'No'))}
                    ${td(fmtTime(r.createdAt))}
                </tr>`;
            }));
            dataRows.push(...batchRows);
        }

        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Parichay Records With Photos</title>
<style>
  body{font-family:Calibri,Arial,sans-serif;font-size:10px;margin:16px;}
  table{border-collapse:collapse;width:100%;}
  @media print{body{margin:0;}}
</style></head><body>
<h2 style="font-family:Arial;color:#1a3c6e;margin-bottom:12px;">Parichay Records — ${getDateStr()}</h2>
<table><thead><tr>${header}</tr></thead><tbody>${dataRows.join('')}</tbody></table>
</body></html>`;

        const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 2000);

        btn.textContent = origText;
        btn.disabled = false;
    }

    document.getElementById('btnAdminExportNoPhoto').onclick = async () => {
        menu.classList.remove('export-dropdown-menu--open');
        const btn = document.getElementById('btnAdminExportNoPhoto');
        const origText = btn.textContent;
        btn.textContent = 'Preparing…';
        btn.disabled = true;
        try {
            const records = await fetchAllRecords(document.getElementById('filterFrom').value, document.getElementById('filterTo').value);
            if (!records) return; // auth error already handled
            if (!records.length) { alert('No records to export.'); return; }
            exportCleanXLSX(`EntryPass_Records_${getDateStr()}.xlsx`, records);
        } catch (err) {
            console.error('Export failed:', err);
            alert('Export failed. Please try again.');
        } finally {
            btn.textContent = origText;
            btn.disabled = false;
        }
    };

    document.getElementById('btnAdminExportWithPhoto').onclick = async () => {
        menu.classList.remove('export-dropdown-menu--open');
        try {
            const records = await fetchAllRecords(document.getElementById('filterFrom').value, document.getElementById('filterTo').value);
            if (!records) return; // auth error already handled
            if (!records.length) { alert('No records to export.'); return; }
            await exportWithPhotosHTML(`EntryPass_Records_WithPhotos_${getDateStr()}.html`, records);
        } catch (err) {
            console.error('Export failed:', err);
            alert('Export failed. Please try again.');
        }
    };
})();

// ------ MANAGE (CRUD) ------
function _manageSiteParam(key) {
    if (key === 'sites') return '';
    const site = getEffectiveSite();
    return site ? `?site=${encodeURIComponent(site)}` : '';
}

async function getListAPI(key) {
    try {
        const res = await fetch(`${API}/api/${key}${_manageSiteParam(key)}`, { headers: adminHeaders() });
        if (handleAuthError(res)) return [];
        return res.ok ? await res.json() : [];
    } catch (e) { console.error(e); return []; }
}
async function saveListAPI(key, arr) {
    try {
        const res = await fetch(`${API}/api/${key}${_manageSiteParam(key)}`, {
            method: 'POST',
            headers: adminHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ data: arr })
        });
        if (handleAuthError(res)) return false;
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            showAlert(body.error || 'Could not save changes. Please try again.');
            return false;
        }
        return true;
    } catch (e) {
        console.error(e);
        showAlert('Could not save changes. Check connection and try again.');
        return false;
    }
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

// ── Drag-and-drop state ──────────────────────────────────────────────────────
let _dragSrc = null;
const _manageSelections = { contractors: new Set(), roles: new Set() };
const _manageSelectMode = { contractors: false, roles: false };

function _makeDraggable(ul, key, listId) {
    ul.querySelectorAll('li[draggable="true"]').forEach(li => {
        li.addEventListener('dragstart', e => {
            if (e.target.closest('.manage-select-check')) {
                e.preventDefault();
                return;
            }
            _dragSrc = li;
            li.classList.add('drag-active');
            e.dataTransfer.effectAllowed = 'move';
        });
        li.addEventListener('dragend', () => {
            li.classList.remove('drag-active');
            ul.querySelectorAll('li').forEach(n => n.classList.remove('drag-over'));
            _dragSrc = null;
        });
        li.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (_dragSrc && _dragSrc !== li) {
                ul.querySelectorAll('li').forEach(n => n.classList.remove('drag-over'));
                li.classList.add('drag-over');
            }
        });
        li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
        li.addEventListener('drop', async e => {
            e.preventDefault();
            li.classList.remove('drag-over');
            if (!_dragSrc || _dragSrc === li) return;
            // Reorder in DOM
            const allLi = [...ul.querySelectorAll('li[draggable="true"]')];
            const fromIdx = allLi.indexOf(_dragSrc);
            const toIdx   = allLi.indexOf(li);
            if (fromIdx === -1 || toIdx === -1) return;
            if (fromIdx < toIdx) li.after(_dragSrc);
            else li.before(_dragSrc);
            // Persist new order
            const newOrder = [...ul.querySelectorAll('li[draggable="true"]')].map(n => n.dataset.value);
            if (!(await saveListAPI(key, newOrder))) return renderManageList(key, listId);
            showDragSaved(ul);
        });
    });
}

function showDragSaved(ul) {
    let msg = ul.parentElement.querySelector('.drag-saved-msg');
    if (!msg) return;
    msg.textContent = '✓ Order saved';
    msg.style.opacity = '1';
    clearTimeout(msg._t);
    msg._t = setTimeout(() => { msg.style.opacity = '0'; }, 1800);
}

async function renderManageList(key, listId) {
    const items = await getListAPI(key);
    const ul = document.getElementById(listId);
    if (!ul) return;
    ul.innerHTML = '';
    const draggable = ul.classList.contains('manage-list--draggable');
    const inSelectMode = _manageSelectMode[key];

    // Prune stale selections
    if (inSelectMode) {
        const currentValues = new Set(items);
        [..._manageSelections[key]].forEach(v => { if (!currentValues.has(v)) _manageSelections[key].delete(v); });
    }

    items.forEach((item, idx) => {
        const li = document.createElement('li');
        li.id = `item-${key}-${idx}`;
        li.dataset.value = item;
        li.dataset.idx = idx + 1;
        if (inSelectMode) li.classList.add('select-mode');

        const checked = inSelectMode && _manageSelections[key].has(item) ? ' checked' : '';
        const checkbox = inSelectMode
            ? `<input type="checkbox" class="manage-select-check"${checked} />`
            : '';
        const actions = inSelectMode ? '' : `<div class="manage-actions">
            <button class="btn-edit" title="Edit" onclick="startInlineEdit('${esc(key)}', ${idx}, '${esc(listId)}')">✎</button>
            <button class="btn-remove" title="Delete" onclick="confirmRemoveItem('${esc(key)}', ${idx}, '${esc(listId)}')">✕</button>
        </div>`;

        if (draggable && !inSelectMode) {
            li.draggable = true;
            li.innerHTML = `<span class="drag-handle" title="Drag to reorder">⠿</span>${checkbox}<span class="item-text">${esc(item)}</span>${actions}`;
        } else {
            li.innerHTML = `${checkbox}<span class="item-text">${esc(item)}</span>${actions}`;
        }

        if (inSelectMode) {
            // Clicking anywhere on the row toggles selection
            li.addEventListener('click', () => {
                const chk = li.querySelector('.manage-select-check');
                chk.checked = !chk.checked;
                _toggleSelection(key, item, chk.checked);
                _updateBulkToolbar(key, listId, items.length);
            });
            const chk = li.querySelector('.manage-select-check');
            if (chk) {
                chk.addEventListener('click', e => e.stopPropagation()); // handled by li click
            }
        }

        ul.appendChild(li);
    });

    if (draggable && !inSelectMode) _makeDraggable(ul, key, listId);
    _updateBulkToolbar(key, listId, items.length);
}

function _toggleSelection(key, value, checked) {
    if (checked) _manageSelections[key].add(value);
    else _manageSelections[key].delete(value);
}

function _updateBulkToolbar(key, listId, total) {
    if (!_manageSelections[key]) return; // key doesn't support bulk-select (e.g. sites)
    const selected = _manageSelections[key].size;
    const countEl = document.getElementById(`bulkCount-${key}`);
    const deleteBtn = document.getElementById(`btnBulkDelete-${key}`);
    const selectAllChk = document.getElementById(`chkSelectAll-${key}`);
    if (countEl) countEl.textContent = selected === 0 ? '0' : `${selected}/${total}`;
    if (deleteBtn) deleteBtn.disabled = selected === 0;
    if (selectAllChk) {
        selectAllChk.checked = total > 0 && selected === total;
        selectAllChk.indeterminate = selected > 0 && selected < total;
    }
}

function toggleSelectMode(key, listId) {
    _manageSelectMode[key] = !_manageSelectMode[key];
    if (!_manageSelectMode[key]) _manageSelections[key].clear();

    const toolbar = document.getElementById(`bulkToolbar-${key}`);
    const btn = document.getElementById(`btnSelectMode-${key}`);
    const addArea = document.getElementById(`addArea-${key}`);
    if (toolbar) toolbar.style.display = _manageSelectMode[key] ? '' : 'none';
    if (btn) btn.classList.toggle('active', _manageSelectMode[key]);
    if (addArea) addArea.style.display = _manageSelectMode[key] ? 'none' : '';

    renderManageList(key, listId);
}

function handleSelectAll(key, listId, checked) {
    const ul = document.getElementById(listId);
    if (!ul) return;
    const items = [...ul.querySelectorAll('li[data-value]')].map(li => li.dataset.value);
    _manageSelections[key].clear();
    if (checked) items.forEach(v => _manageSelections[key].add(v));
    // Update all checkboxes in the list
    ul.querySelectorAll('.manage-select-check').forEach((chk, i) => {
        chk.checked = checked;
    });
    _updateBulkToolbar(key, listId, items.length);
}

async function deleteSelectedManageItems(key, listId) {
    if (!_manageSelections[key] || _manageSelections[key].size === 0) return;
    const count = _manageSelections[key].size;
    const label = key === 'roles' ? 'designation' : 'contractor';
    const plural = count === 1 ? label : `${label}s`;
    if (!(await showConfirm(`Permanently delete ${count} selected ${plural}?`))) return;
    const selected = new Set(_manageSelections[key]);
    const items = await getListAPI(key);
    if (!(await saveListAPI(key, items.filter(item => !selected.has(item))))) return;
    _manageSelections[key].clear();
    // Exit select mode after deletion
    _manageSelectMode[key] = false;
    const toolbar = document.getElementById(`bulkToolbar-${key}`);
    const btn = document.getElementById(`btnSelectMode-${key}`);
    const addArea = document.getElementById(`addArea-${key}`);
    if (toolbar) toolbar.style.display = 'none';
    if (btn) btn.classList.remove('active');
    if (addArea) addArea.style.display = '';
    renderManageList(key, listId);
}

function startInlineEdit(key, idx, listId) {
    const li = document.getElementById(`item-${key}-${idx}`);
    const span = li.querySelector('.item-text');
    const originalVal = span.textContent;
    li.innerHTML = `
        <input type="text" class="inline-edit-input" value="${esc(originalVal)}" />
        <div class="manage-actions" style="opacity:1;">
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
    items[idx] = newVal;
    if (!(await saveListAPI(key, items))) return renderManageList(key, listId);
    document.getElementById(`item-${key}-${idx}`).innerHTML = `<span class="item-text" style="font-weight:700;">${esc(newVal)}</span><span class="inline-edit-success">✓ Updated</span>`;
    setTimeout(() => renderManageList(key, listId), 2000);
}

async function confirmRemoveItem(key, idx, listId) {
    const items = await getListAPI(key);
    if (await showConfirm(`Delete "${items[idx]}" permanently?`)) {
        items.splice(idx, 1);
        if (!(await saveListAPI(key, items))) return;
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
    items.push(val);
    if (!(await saveListAPI(key, items))) return;
    toggleAddForm(key);
    const area = document.getElementById(`addArea-${key}`);
    const success = area.querySelector('.add-success-msg');
    success.textContent = '✓ Added successfully';
    renderManageList(key, listId);
    if (key === 'sites' && isSuperAdmin()) buildSiteSelector();
    setTimeout(() => success.textContent = '', 3000);
}

async function sortListAlpha(key, listId) {
    const items = await getListAPI(key);
    const sorted = [...items].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    if (!(await saveListAPI(key, sorted))) return;
    renderManageList(key, listId);
}

// ── Super-admin site selector ────────────────────────────────────────────────
// Which site the super admin is currently editing (null = their own / site admin's site)
let _manageSite = null;

let _knownSites = ['Udyan', 'Vyoma', 'Nishada', 'Vipina', 'TTPL', 'Apas', 'Grava'];

function getEffectiveSite() {
    // Site admin: always their own site (from session)
    if (!isSuperAdmin()) return getAdminSite();
    // Super admin: whichever tab they selected
    return _manageSite;
}

async function buildSiteSelector() {
    const bar = document.getElementById('manageSiteBar');
    const tabs = document.getElementById('manageSiteTabs');
    if (!bar || !tabs) return;
    const sites = await getListAPI('sites');
    if (sites.length) _knownSites = sites;
    if (!_knownSites.includes(_manageSite)) _manageSite = _knownSites[0] || null;
    bar.style.display = '';
    tabs.innerHTML = '';
    _knownSites.forEach(site => {
        const btn = document.createElement('button');
        btn.className = 'manage-site-tab' + (site === _manageSite ? ' active' : '');
        btn.textContent = site;
        btn.onclick = () => selectManageSite(site);
        tabs.appendChild(btn);
    });
}

async function renderManageSiteScopedLists(site, showTransition = true) {
    _manageSite = site;
    document.querySelectorAll('.manage-site-tab').forEach(b => {
        b.classList.toggle('active', b.textContent === site);
    });
    const grid = document.getElementById('manageGrid');
    const bar = document.getElementById('manageSiteBar');
    if (showTransition && grid) {
        grid.classList.add('manage-grid--switching');
        grid.setAttribute('aria-busy', 'true');
    }
    if (showTransition && bar) {
        bar.classList.add('manage-site-bar--switching');
        bar.dataset.switchingSite = `Switching to ${site}`;
    }
    const minimumSwitchTime = new Promise(resolve => setTimeout(resolve, 850));
    const tasks = [
        renderManageList('contractors', 'contractorList'),
        renderManageList('roles', 'roleList')
    ];
    if (showTransition) tasks.unshift(minimumSwitchTime);
    await Promise.all(tasks);
    if (grid) {
        grid.classList.remove('manage-grid--switching');
        grid.removeAttribute('aria-busy');
    }
    if (bar) {
        bar.classList.remove('manage-site-bar--switching');
        delete bar.dataset.switchingSite;
    }
}

async function selectManageSite(site) {
    // Exit select mode when switching or refreshing sites
    ['contractors', 'roles'].forEach(key => {
        if (_manageSelectMode[key]) toggleSelectMode(key, key === 'contractors' ? 'contractorList' : 'roleList');
    });
    await renderManageSiteScopedLists(site, true);
}

async function loadManageLists() {
    const superAdmin = isSuperAdmin();
    const siteCard = document.getElementById('siteManageCard');
    const manageGrid = document.getElementById('manageGrid');
    if (superAdmin) {
        // Default to first site if none selected
        if (!_manageSite) _manageSite = _knownSites[0];
        if (siteCard) siteCard.style.display = '';
        if (manageGrid) manageGrid.classList.remove('manage-grid--two');
        await buildSiteSelector();
        await renderManageList('sites', 'siteList');
        if (_manageSite) {
            await renderManageSiteScopedLists(_manageSite, true);
        }
        return;
    } else {
        const bar = document.getElementById('manageSiteBar');
        if (bar) bar.style.display = 'none';
        if (siteCard) siteCard.style.display = 'none';
        if (manageGrid) manageGrid.classList.add('manage-grid--two');
    }
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
let _confirmReject = null;
function showConfirm(msg) {
    // Reject any prior pending confirm to prevent race conditions
    if (_confirmReject) { _confirmReject(false); _confirmReject = null; }
    return new Promise((resolve) => {
        _confirmReject = () => { document.getElementById('confirmModal').style.display = 'none'; resolve(false); };
        document.getElementById('confirmMessage').textContent = msg;
        document.getElementById('confirmModal').style.display = 'flex';
        document.getElementById('confirmYes').onclick = () => { _confirmReject = null; document.getElementById('confirmModal').style.display = 'none'; resolve(true); };
        document.getElementById('confirmNo').onclick = () => { _confirmReject = null; document.getElementById('confirmModal').style.display = 'none'; resolve(false); };
    });
}

// Close modals on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const alert = document.getElementById('customAlert');
        const confirm = document.getElementById('confirmModal');
        if (confirm.style.display === 'flex') { document.getElementById('confirmNo').click(); }
        else if (alert.style.display === 'flex') { document.getElementById('closeAlert').click(); }
    }
});

checkState();
