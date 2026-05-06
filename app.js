/* Purview AI PAYG calculator
 * Simplified input model (mirrors https://refactored-enigma-l1ygz9q.pages.github.io):
 *   - one monthly-interactions input per zone (Z1B, Z2, Z3)
 *   - Z1A is free reference, no input
 *   - Focus dropdown filters which zones contribute to cost
 *   - All capability knobs mirror Purview admin controls (no low-level meters)
 */

const RATES = {
  ccPremiumPerKRecord: 0.50,
  msgToTextRecords: 2.5,
  dlmPerMmsg: 6.00,
  cpPerKReq: 0.50,
  cpReqDivisor: 10000,
  msgToCpRequests: 2.5,
  auditPerMrec: 15.00,
  msgToAuditRecords: 1.5,
  dsiGB: 5.00,
  dsiUnit: 5.00,
  edGB: 20.00,
  irmPerMlog: 1.00,
  irmPremiumMultiplier: 2.0,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const fmt = (n) => Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '0';
const num = (id, def = 0) => {
  const v = parseFloat(($(id) || {}).value);
  return Number.isFinite(v) ? v : def;
};
const radio = (name) => {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : null;
};
const scope = (cls) => $$(`.${cls}`).filter(c => c.checked).map(c => c.value);

function readZones() {
  const focus = ($('#focus') || {}).value || 'all';
  const include = (z) => focus === 'all' || focus === z;
  return {
    z1a: { vol: 0 },
    z1b: { vol: include('z1') ? num('#z1b-msgs') : 0 },
    z2:  { vol: include('z2') ? num('#z2-msgs')  : 0 },
    z3:  { vol: include('z3') ? num('#z3-msgs')  : 0 },
  };
}

function applyFocusFilter() {
  const focus = ($('#focus') || {}).value || 'all';
  const map = { z1a: true, z1b: true, z2: true, z3: true };
  if (focus === 'z1') { map.z2 = false; map.z3 = false; }
  if (focus === 'z2') { map.z1b = false; map.z3 = false; }
  if (focus === 'z3') { map.z1b = false; map.z2 = false; }
  $$('.zone').forEach(el => {
    const z = el.getAttribute('data-zone');
    el.style.display = map[z] ? '' : 'none';
  });
  // Hide whole zone-card wrappers when none of their inner zones are visible
  const groupVisible = { z1: map.z1a || map.z1b, z2: map.z2, z3: map.z3 };
  $$('.zone-card[data-zone-group]').forEach(el => {
    const g = el.getAttribute('data-zone-group');
    el.style.display = groupVisible[g] ? '' : 'none';
  });
}

/* ---------------- cost functions (consume zones[z].vol) ---------------- */
function ccCost(zones, license) {
  const mode = radio('cc-mode');
  if (mode === 'off') return { cost: 0, line: 'CC: off' };
  const sampling = num('#cc-sampling') / 100;
  const inScope = scope('cc-scope');
  const vol = inScope.reduce((s, z) => s + (zones[z]?.vol || 0), 0);
  const sampled = vol * sampling;
  const records = sampled * RATES.msgToTextRecords;
  if (mode === 'basic' || license === 'E3') {
    return { cost: 0, line: `CC Basic: ${fmt(sampled)} sampled msgs → $0 (Basic — included)` };
  }
  const cost = (records / 1000) * RATES.ccPremiumPerKRecord;
  return { cost, line: `CC Premium: ${fmt(vol)} × ${sampling*100}% = ${fmt(sampled)} msgs × ${RATES.msgToTextRecords} = ${fmt(records)} records → $${fmt(cost)}` };
}

function dlmCost(zones, license) {
  const mode = radio('dlm-mode');
  if (mode === 'off') return { cost: 0, line: 'DLM: off' };
  const years = num('#dlm-retention');
  const inScope = scope('dlm-scope');
  const vol = inScope.reduce((s, z) => s + (zones[z]?.vol || 0), 0);
  const mMsgYears = (vol / 1_000_000) * years;
  if (mode === 'basic') {
    return { cost: 0, line: `DLM Basic: ${fmt(vol)} msgs × ${years}yr → $0 (Basic — included)` };
  }
  const cost = mMsgYears * RATES.dlmPerMmsg;
  return { cost, line: `DLM Premium: ${fmt(vol)} msgs × ${years}yr = ${fmt(mMsgYears)} M msg-yr → $${fmt(cost)}` };
}

function cpCost(zones) {
  if (radio('cp-mode') === 'off') return { cost: 0, line: 'CP: off' };
  const coverage = num('#cp-coverage') / 100;
  const vol = (zones.z3?.vol || 0) * coverage;
  const requests = vol * RATES.msgToCpRequests;
  const cost = (requests / RATES.cpReqDivisor) * RATES.cpPerKReq;
  return { cost, line: `CP: Z3 ${fmt(zones.z3?.vol || 0)} × ${coverage*100}% = ${fmt(vol)} msgs × ${RATES.msgToCpRequests} = ${fmt(requests)} requests → $${fmt(cost)}` };
}

function auditCost(zones, license) {
  const mode = radio('audit-mode');
  if (license === 'E3' || mode === 'standard') {
    return { cost: 0, line: `Audit Standard: bundled — $0` };
  }
  const z3 = zones.z3?.vol || 0;
  const records = z3 * RATES.msgToAuditRecords;
  const cost = (records / 1_000_000) * RATES.auditPerMrec;
  return { cost, line: `Audit Premium: Z3 ${fmt(z3)} × ${RATES.msgToAuditRecords} = ${fmt(records)} records → $${fmt(cost)}` };
}

function irmCost() {
  const mode = radio('irm-mode');
  if (mode === 'off') return { cost: 0, line: 'IRM: off' };
  const mlogs = num('#irm-logs');
  const mult = mode === 'premium' ? RATES.irmPremiumMultiplier : 1;
  const cost = mlogs * RATES.irmPerMlog * mult;
  return { cost, line: `IRM ${mode}: ${fmt(mlogs)} M logs × $${RATES.irmPerMlog}${mult > 1 ? ` × ${mult}` : ''} → $${fmt(cost)}` };
}

function dsiCost(license) {
  if (license === 'E3' || radio('dsi-mode') === 'off') {
    return { cost: 0, line: 'DSI: off / not available on E3' };
  }
  const gb = num('#dsi-gb'); const units = num('#dsi-units');
  const cost = gb * RATES.dsiGB + units * RATES.dsiUnit;
  return { cost, line: `DSI: ${gb} GB × $${RATES.dsiGB} + ${units} units × $${RATES.dsiUnit} → $${fmt(cost)}` };
}

function edCost(license) {
  if (license === 'E3' || radio('ed-mode') === 'off') {
    return { cost: 0, line: 'eDiscovery: off / not available on E3' };
  }
  const gb = num('#ed-gb');
  const cost = gb * RATES.edGB;
  return { cost, line: `eDiscovery: ${gb} GB × $${RATES.edGB} → $${fmt(cost)}` };
}

/* ---------------- E3/E5 license enforcement ---------------- */
function enforceLicense() {
  const lic = ($('#license') || {}).value || 'E5';
  const isE3 = lic === 'E3';
  const lock = (radioName, allowed) => {
    $$(`input[name="${radioName}"]`).forEach(r => {
      const ok = allowed.includes(r.value);
      r.disabled = !ok;
      if (!ok && r.checked) {
        const fallback = $$(`input[name="${radioName}"]`).find(x => allowed.includes(x.value));
        if (fallback) fallback.checked = true;
      }
    });
  };
  if (isE3) {
    lock('cc-mode', ['off', 'basic']);
    lock('dlm-mode', ['off', 'basic']);
    lock('audit-mode', ['standard']);
    lock('irm-mode', ['off', 'standard']);
    lock('dsi-mode', ['off']);
    lock('ed-mode', ['off']);
  } else {
    ['cc-mode','dlm-mode','audit-mode','irm-mode','dsi-mode','ed-mode'].forEach(n =>
      $$(`input[name="${n}"]`).forEach(r => { r.disabled = false; })
    );
  }
}

/* ---------------- main recompute ---------------- */
function recompute() {
  enforceLicense();
  applyFocusFilter();
  const lic = ($('#license') || {}).value || 'E5';
  const zones = readZones();

  const cc = ccCost(zones, lic);
  const dlm = dlmCost(zones, lic);
  const cp = cpCost(zones);
  const audit = auditCost(zones, lic);
  const irm = irmCost();
  const dsi = dsiCost(lic);
  const ed = edCost(lic);

  $('#cc-meter').textContent = cc.line;
  $('#dlm-meter').textContent = dlm.line;
  $('#cp-meter').textContent = cp.line;
  $('#audit-meter').textContent = audit.line;
  $('#irm-meter').textContent = irm.line;
  $('#dsi-meter').textContent = dsi.line;
  $('#ed-meter').textContent = ed.line;

  const payg = cc.cost + dlm.cost + cp.cost + audit.cost + irm.cost + dsi.cost;
  $('#total-payg').textContent = fmt(payg);
  $('#total-ed').textContent = fmt(ed.cost);

  const list = $('#deriv-list');
  list.innerHTML = '';
  [cc, dlm, cp, audit, irm, dsi, ed].forEach(r => {
    const li = document.createElement('li');
    li.textContent = r.line;
    list.appendChild(li);
  });
}

/* ---------------- wiring ---------------- */
function wire() {
  const inputs = $$('input, select');
  inputs.forEach(el => {
    el.addEventListener('input', recompute);
    el.addEventListener('change', recompute);
  });
  $('#reveal-btn').addEventListener('click', () => {
    const d = $('#drawer');
    const open = !d.hasAttribute('hidden');
    if (open) d.setAttribute('hidden', '');
    else d.removeAttribute('hidden');
    $('#reveal-btn').textContent = open ? 'Show derivations' : 'Hide derivations';
  });
  recompute();
}

document.addEventListener('DOMContentLoaded', wire);
