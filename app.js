// Purview AI PAYG Cost Calculator — v3 reference-aligned, per-workload policies
'use strict';

// ===== Reference-site rates =====
const RATES = {
  cc:           { unit: 1_000,     price: 0.50,  label: '$0.50 / 1K text records' },
  dlm:          { unit: 1_000_000, price: 6.00,  label: '$6.00 / 1M messages' },
  irm:          { unit: 10_000,    price: 25.00, label: '$25.00 / 10K activities' },
  auditZ3:      { unit: 1_000_000, price: 15.00, label: '$15.00 / 1M records' },
  collection:   { unit: 10_000,    price: 0.50,  label: '$0.50 / 10K requests' },
  dsiGB:        { price: 5.00,  label: '$5.00 / GB-month' },
  dsiCompute:   { price: 5.00,  label: '$5.00 / Compute Unit' },
  edGB:         { price: 20.00, label: '$20.00 / GB-month' },
};

// Per-policy multipliers: how msgs/mo translate to billable units
const MULTIPLIERS = {
  cc:         1.0,   // 1 msg = 1 text record
  dlm:        1.0,   // 1 msg = 1 message
  irm:        0.10,  // ~10% of msgs trigger an IRM activity
  auditZ3:    1.5,   // each 3rd party msg = 1.5 audit records
  collection: 2.5,   // each 3rd party msg = 2.5 collection requests
};

// Volume model: msgs/user/day × working days
const INTENSITY = { light: 5, typical: 20, heavy: 60 };
const WORKING_DAYS = 22;

// Workload definitions
const WORKLOADS = [
  { id: 'msCopilot',    label: 'Microsoft Copilot' },
  { id: 'customAgents', label: 'Custom Agents' },
  { id: 'thirdParty',   label: '3rd Party AI' },
];

// Which optional policies are user-toggleable per workload
// (Audit/Collection/EndpointDLP/CopilotStudio are forced/disabled in markup)
const WL_OPTIONAL_POLICIES = {
  msCopilot:    ['cc', 'dlm', 'irm'],
  customAgents: ['cc', 'dlm', 'irm'],
  thirdParty:   ['cc', 'dlm', 'irm'],
};

// ===== Utilities =====
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function fmtMoney(n) {
  if (!isFinite(n)) n = 0;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtNum(n) {
  if (!isFinite(n)) n = 0;
  return Math.round(n).toLocaleString('en-US');
}

// ===== Read state from DOM =====
function readWorkload(wlId) {
  const card = document.querySelector(`.wl-card[data-wl="${wlId}"]`);
  if (!card) return null;
  const included = $('.wl-toggle', card)?.checked || false;
  const users = parseInt($('.wl-users', card)?.value, 10) || 0;
  const intensity = $(`input[name="int-${wlId}"]:checked`, card)?.value || 'typical';
  const msgsPerDay = INTENSITY[intensity] || INTENSITY.typical;
  const msgsPerMonth = users * msgsPerDay * WORKING_DAYS;

  // Read enabled policies (incl. forced-checked ones for cost calc)
  const policies = {};
  $$('.wl-policies input[type="checkbox"]', card).forEach(cb => {
    policies[cb.dataset.pol] = cb.checked;
  });

  return { id: wlId, included, users, intensity, msgsPerMonth, policies };
}

function readDsi() {
  return {
    included: $('.tn-toggle[data-tn="dsi"]')?.checked || false,
    gb: parseFloat($('#dsi-gb')?.value) || 0,
    units: parseFloat($('#dsi-units')?.value) || 0,
  };
}
function readEdisc() {
  return {
    included: $('.tn-toggle[data-tn="edisc"]')?.checked || false,
    gb: parseFloat($('#edisc-gb')?.value) || 0,
  };
}

// ===== Cost computations =====
function policyCost(rateKey, msgs) {
  const rate = RATES[rateKey];
  const mult = MULTIPLIERS[rateKey] ?? 1.0;
  if (!rate || msgs <= 0) return 0;
  const billableUnits = msgs * mult;
  return (billableUnits / rate.unit) * rate.price;
}

function computeWorkloadCost(wl) {
  if (!wl.included || wl.msgsPerMonth <= 0) {
    return { subtotal: 0, lineItems: [] };
  }
  const items = [];
  let subtotal = 0;
  const m = wl.msgsPerMonth;

  // Audit (3rd party only is paid)
  if (wl.id === 'thirdParty' && wl.policies.audit) {
    const cost = policyCost('auditZ3', m);
    items.push({ cap: 'Audit (required)', vol: `${fmtNum(m * 1.5)} records`, rate: RATES.auditZ3.label, cost });
    subtotal += cost;
  } else if (wl.policies.audit) {
    items.push({ cap: 'Audit', vol: '—', rate: 'Included $0', cost: 0 });
  }

  // Copilot Studio audit (custom agents only — informational)
  if (wl.id === 'customAgents' && wl.policies.copilotStudio) {
    items.push({ cap: 'Copilot Studio Audit', vol: '—', rate: 'Included $0', cost: 0 });
  }

  // Collection Policies (3rd party only)
  if (wl.id === 'thirdParty' && wl.policies.collection) {
    const cost = policyCost('collection', m);
    items.push({ cap: 'Collection Policies — In-Transit Protection (required)', vol: `${fmtNum(m * 2.5)} requests`, rate: RATES.collection.label, cost });
    subtotal += cost;
  }

  // Endpoint DLP (3rd party only — informational)
  if (wl.id === 'thirdParty' && wl.policies.endpointDlp) {
    items.push({ cap: 'Endpoint DLP', vol: '—', rate: 'Included — $0', cost: 0 });
  }

  // Communication Compliance
  if (wl.policies.cc) {
    const cost = policyCost('cc', m);
    items.push({ cap: 'Communication Compliance', vol: `${fmtNum(m)} text records`, rate: RATES.cc.label, cost });
    subtotal += cost;
  }

  // Data Lifecycle Management
  if (wl.policies.dlm) {
    const cost = policyCost('dlm', m);
    items.push({ cap: 'Data Lifecycle Mgmt', vol: `${fmtNum(m)} messages`, rate: RATES.dlm.label, cost });
    subtotal += cost;
  }

  // Insider Risk Management
  if (wl.policies.irm) {
    const cost = policyCost('irm', m);
    items.push({ cap: 'Insider Risk Mgmt', vol: `${fmtNum(m * MULTIPLIERS.irm)} activities`, rate: RATES.irm.label, cost });
    subtotal += cost;
  }

  return { subtotal, lineItems: items };
}

function computeDsiCost(dsi) {
  if (!dsi.included) return { subtotal: 0, lineItems: [] };
  const storage = dsi.gb * RATES.dsiGB.price;
  const compute = dsi.units * RATES.dsiCompute.price;
  const items = [];
  if (dsi.gb > 0) items.push({ cap: 'DSI Storage', vol: `${fmtNum(dsi.gb)} GB`, rate: RATES.dsiGB.label, cost: storage });
  if (dsi.units > 0) items.push({ cap: 'DSI AI Compute', vol: `${fmtNum(dsi.units)} units`, rate: RATES.dsiCompute.label, cost: compute });
  return { subtotal: storage + compute, lineItems: items };
}

function computeEdiscCost(ed) {
  if (!ed.included) return { subtotal: 0, lineItems: [] };
  const cost = ed.gb * RATES.edGB.price;
  const items = [];
  if (ed.gb > 0) items.push({ cap: 'eDiscovery Premium', vol: `${fmtNum(ed.gb)} GB review-set`, rate: RATES.edGB.label, cost });
  return { subtotal: cost, lineItems: items };
}

// ===== Render =====
function renderWorkloadCard(wl, result) {
  // msgs display
  const msgsEl = document.querySelector(`.wl-msgs[data-wl="${wl.id}"]`);
  if (msgsEl) msgsEl.textContent = fmtNum(wl.msgsPerMonth);

  // subtotal pill
  const subEl = document.getElementById(`sub-${wl.id}`);
  if (subEl) subEl.textContent = `${fmtMoney(result.subtotal)} /mo`;

  // dim card if not included
  const card = document.querySelector(`.wl-card[data-wl="${wl.id}"]`);
  if (card) card.classList.toggle('wl-card--off', !wl.included);
}

function renderTenantCard(tn, result, subElId) {
  const subEl = document.getElementById(subElId);
  if (subEl) subEl.textContent = `${fmtMoney(result.subtotal)} /mo`;
  const card = document.querySelector(`.tenant-card[data-tn="${tn}"]`);
  if (card) card.classList.toggle('wl-card--off', result.subtotal === 0 && !document.querySelector(`.tn-toggle[data-tn="${tn}"]`)?.checked);
}

function renderLedger(rows) {
  const body = $('#ledger-body');
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5" class="ledger-empty">Enable a workload &amp; policy above to see derivations.</td></tr>';
    return;
  }
  body.innerHTML = rows.map(r => `
    <tr>
      <td>${r.workload}</td>
      <td>${r.cap}</td>
      <td>${r.vol}</td>
      <td>${r.rate}</td>
      <td class="num">${fmtMoney(r.cost)}</td>
    </tr>
  `).join('');
}

function renderHeader(workloadTotal, dsiTotal, ediscTotal) {
  const paygTotal = workloadTotal + dsiTotal;
  const allIn = paygTotal + ediscTotal;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('header-total', '');
  const totalEl = $('#header-total');
  if (totalEl) totalEl.innerHTML = fmtMoney(paygTotal) + '<span class="hdr-mo">/mo</span>';
  set('header-workloads', fmtMoney(workloadTotal));
  set('header-dsi', fmtMoney(dsiTotal));
  set('header-edisc', fmtMoney(ediscTotal));
  set('header-allin', fmtMoney(allIn) + '/mo');
}

// ===== Main recompute =====
function recompute() {
  const ledgerRows = [];
  let workloadTotal = 0;

  WORKLOADS.forEach(({ id, label }) => {
    const wl = readWorkload(id);
    if (!wl) return;
    const res = computeWorkloadCost(wl);
    renderWorkloadCard(wl, res);
    if (wl.included) {
      workloadTotal += res.subtotal;
      res.lineItems.forEach(li => ledgerRows.push({ workload: label, ...li }));
    }
  });

  const dsi = readDsi();
  const dsiRes = computeDsiCost(dsi);
  renderTenantCard('dsi', dsiRes, 'sub-dsi');
  if (dsi.included) dsiRes.lineItems.forEach(li => ledgerRows.push({ workload: 'Tenant-wide', ...li }));

  const ed = readEdisc();
  const edRes = computeEdiscCost(ed);
  renderTenantCard('edisc', edRes, 'sub-edisc');
  if (ed.included) edRes.lineItems.forEach(li => ledgerRows.push({ workload: 'Tenant-wide (separate)', ...li }));

  renderHeader(workloadTotal, dsiRes.subtotal, edRes.subtotal);
  renderLedger(ledgerRows);
}

// ===== Reset =====
function resetAll() {
  // Workload toggles: only msCopilot ON
  $$('.wl-toggle').forEach(cb => { cb.checked = (cb.dataset.wl === 'msCopilot'); });
  // Users
  document.querySelector('.wl-users[data-wl="msCopilot"]').value = 1000;
  document.querySelector('.wl-users[data-wl="customAgents"]').value = 0;
  document.querySelector('.wl-users[data-wl="thirdParty"]').value = 0;
  // Intensity = typical
  ['msCopilot','customAgents','thirdParty'].forEach(wl => {
    const r = document.querySelector(`input[name="int-${wl}"][value="typical"]`);
    if (r) r.checked = true;
  });
  // Optional policies all off
  $$('.wl-policies input[type="checkbox"]:not([disabled])').forEach(cb => { cb.checked = false; });
  // Tenant
  $$('.tn-toggle').forEach(cb => { cb.checked = false; });
  $('#dsi-gb').value = 0;
  $('#dsi-units').value = 0;
  $('#edisc-gb').value = 0;
  recompute();
}

// ===== Wire up =====
function init() {
  document.addEventListener('input', recompute);
  document.addEventListener('change', recompute);
  $('#reset-btn')?.addEventListener('click', resetAll);
  recompute();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
