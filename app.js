// Microsoft Purview AI — PAYG Calculator
// AI-generated planning aid. Mirrors customer-facing Purview admin controls.
//
// Meter rates extracted from the engineering PAYG snapshot reviewed during
// the "Validating PAYG calculator" session. Treat as planning estimates only.

const RATES = {
  ccPremiumPerKRecord: 0.50,        // $/1k text records
  msgToTextRecords: 2.5,            // 1 msg ≈ 2.5 text records
  dlmPerMmsg: 6.00,                 // $/1M messages
  cpPerKReq: 0.50,                  // $/10k requests; we'll use /10000 in code
  cpReqDivisor: 10000,
  msgToCpRequests: 2.5,             // 1 msg ≈ 2.5 collection-policy requests
  auditPerMrec: 15.00,              // $/1M audit records
  msgToAuditRecords: 1.5,
  dsiGB: 5.00,                      // $/GB-month
  dsiUnit: 5.00,                    // $/AI compute unit
  edGB: 20.00,                      // $/GB-month
  irmPerMlog: 1.00,                 // $/1M logs (planning approx — confirm w/ official pricing)
  irmPremiumMultiplier: 2.0         // premium ≈ 2× standard for planning
};

const ZONES = ['z1a','z1b','z2','z3'];

function $(sel, root=document) { return root.querySelector(sel); }
function $$(sel, root=document) { return Array.from(root.querySelectorAll(sel)); }
function fmt(n) {
  if (!isFinite(n)) return '$0.00';
  return '$' + n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
}
function fmtInt(n) {
  if (!isFinite(n)) return '0';
  return Math.round(n).toLocaleString();
}

// -------- read inputs --------
function readZones() {
  const out = {};
  for (const z of ['z1b','z2','z3']) {
    const card = document.querySelector(`.zone[data-zone="${z}"]`);
    const users = parseFloat(card.querySelector('.users').value) || 0;
    const mpu = parseFloat(card.querySelector('.mpu').value) || 0;
    const vol = users * mpu;
    out[z] = { users, mpu, vol };
    card.querySelector('.vol').value = fmtInt(vol);
  }
  out.z1a = { users: 0, mpu: 0, vol: 0 };
  return out;
}

function readChecked(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || 'off';
}

function readZoneCheckboxes(cls) {
  return $$('.' + cls).filter(c => c.checked).map(c => c.value);
}

// -------- per-capability cost --------
function ccCost(zones, tier, sampling, scopeZones) {
  if (tier === 'off' || tier === 'basic') return { cost: 0, note: tier === 'basic' ? 'Basic — included, no PAYG meter' : 'Off' };
  const vol = scopeZones.reduce((s, z) => s + (zones[z]?.vol || 0), 0);
  const reviewed = vol * (sampling / 100);
  const records = reviewed * RATES.msgToTextRecords;
  const cost = records / 1000 * RATES.ccPremiumPerKRecord;
  const note = `Premium: ${fmtInt(vol)} msgs × ${sampling}% sample × ${RATES.msgToTextRecords} rec/msg = ${fmtInt(records)} text records → ${fmt(cost)}`;
  return { cost, note };
}

function dlmCost(zones, tier, retention, scopeZones) {
  if (tier === 'off' || tier === 'basic') return { cost: 0, note: tier === 'basic' ? 'Basic — included, no PAYG meter' : 'Off' };
  const vol = scopeZones.reduce((s, z) => s + (zones[z]?.vol || 0), 0);
  const cost = (vol / 1_000_000) * RATES.dlmPerMmsg * retention;
  const note = `Premium: ${fmtInt(vol)} msgs/mo × $${RATES.dlmPerMmsg}/M × ${retention}-yr retention → ${fmt(cost)}`;
  return { cost, note };
}

function cpCost(zones, tier, coveragePct) {
  if (tier === 'off') return { cost: 0, note: 'Off' };
  const vol = zones.z3.vol;
  const reqs = vol * (coveragePct / 100) * RATES.msgToCpRequests;
  const cost = reqs / RATES.cpReqDivisor * RATES.cpPerKReq;
  const note = `Z3 only: ${fmtInt(vol)} msgs × ${coveragePct}% AI coverage × ${RATES.msgToCpRequests} req/msg = ${fmtInt(reqs)} requests → ${fmt(cost)}`;
  return { cost, note };
}

function auditCost(zones, tier) {
  // standard meter applies to Z3; premium uses same meter at planning level
  const vol = zones.z3.vol;
  const records = vol * RATES.msgToAuditRecords;
  const baseCost = (records / 1_000_000) * RATES.auditPerMrec;
  const cost = tier === 'premium' ? baseCost : baseCost; // same meter; Premium adds features
  const tierLabel = tier === 'premium' ? 'Premium' : 'Standard';
  const note = `${tierLabel}: Z3 only — ${fmtInt(vol)} msgs × ${RATES.msgToAuditRecords} = ${fmtInt(records)} records → ${fmt(cost)}  (Z1B/Z2 included free)`;
  return { cost, note };
}

function irmCost(tier, mlogs) {
  if (tier === 'off') return { cost: 0, note: 'Off' };
  const mult = tier === 'premium' ? RATES.irmPremiumMultiplier : 1.0;
  const cost = mlogs * RATES.irmPerMlog * mult;
  const note = `${tier === 'premium' ? 'Premium' : 'Standard'}: ${mlogs}M logs/mo × $${(RATES.irmPerMlog*mult).toFixed(2)}/M → ${fmt(cost)}  (indicators do not affect price)`;
  return { cost, note };
}

function dsiCost(tier, gb, units) {
  if (tier === 'off') return { cost: 0, note: 'Off' };
  const cost = gb * RATES.dsiGB + units * RATES.dsiUnit;
  const note = `${gb} GB × $${RATES.dsiGB} + ${units} units × $${RATES.dsiUnit} → ${fmt(cost)}`;
  return { cost, note };
}

function edCost(tier, gb) {
  if (tier === 'off') return { cost: 0, note: 'Off' };
  const cost = gb * RATES.edGB;
  const note = `${gb} GB-mo × $${RATES.edGB} → ${fmt(cost)}`;
  return { cost, note };
}

// -------- main recompute --------
function recompute() {
  const license = $('#license').value;

  // Disable Premium tiers when E3 is selected
  const premiumDisable = license !== 'E5';
  $$('input[type=radio][value=premium]').forEach(r => {
    r.disabled = premiumDisable;
    if (premiumDisable && r.checked) {
      // fall back to basic / standard if available, otherwise off
      const name = r.name;
      const fallback = document.querySelector(`input[name="${name}"][value="basic"]`)
        || document.querySelector(`input[name="${name}"][value="standard"]`)
        || document.querySelector(`input[name="${name}"][value="on"]`);
      if (fallback) fallback.checked = true;
    }
  });

  const zones = readZones();

  const cc = ccCost(zones, readChecked('cc-tier'), parseFloat($('#cc-sampling').value)||0, readZoneCheckboxes('cc-zone'));
  const dlm = dlmCost(zones, readChecked('dlm-tier'), parseInt($('#dlm-retention').value)||1, readZoneCheckboxes('dlm-zone'));
  const cp = cpCost(zones, readChecked('cp-tier'), parseFloat($('#cp-coverage').value)||0);
  const audit = auditCost(zones, readChecked('audit-tier'));
  const irm = irmCost(readChecked('irm-tier'), parseFloat($('#irm-logs').value)||0);
  const dsi = dsiCost(readChecked('dsi-tier'), parseFloat($('#dsi-gb').value)||0, parseFloat($('#dsi-units').value)||0);
  const ed = edCost(readChecked('ed-tier'), parseFloat($('#ed-gb').value)||0);

  $('#cc-meter').textContent = cc.note;
  $('#dlm-meter').textContent = dlm.note;
  $('#cp-meter').textContent = cp.note;
  $('#audit-meter').textContent = audit.note;
  $('#irm-meter').textContent = irm.note;
  $('#dsi-meter').textContent = dsi.note;
  $('#ed-meter').textContent = ed.note;

  // PAYG total excludes eDiscovery (kept separate per snapshot convention)
  const payg = cc.cost + dlm.cost + cp.cost + audit.cost + irm.cost + dsi.cost;
  $('#total-payg').textContent = fmt(payg);
  $('#total-ed').textContent = fmt(ed.cost);

  // derivation drawer
  const items = [
    ['Communications Compliance', cc.cost],
    ['Data Lifecycle Management', dlm.cost],
    ['Collection Policies (AI sites)', cp.cost],
    ['Audit', audit.cost],
    ['Insider Risk Management', irm.cost],
    ['Data Security Investigations', dsi.cost],
    ['eDiscovery Premium (separate)', ed.cost]
  ];
  const ul = $('#deriv-list');
  ul.innerHTML = '';
  for (const [name, cost] of items) {
    const li = document.createElement('li');
    li.textContent = `${name}: ${fmt(cost)}`;
    ul.appendChild(li);
  }
}

// -------- wiring --------
function wire() {
  document.addEventListener('input', recompute);
  document.addEventListener('change', recompute);
  $('#reveal-btn').addEventListener('click', () => {
    const d = $('#drawer');
    const hidden = d.hasAttribute('hidden');
    if (hidden) {
      d.removeAttribute('hidden');
      $('#reveal-btn').textContent = 'Hide derivation ▴';
    } else {
      d.setAttribute('hidden','');
      $('#reveal-btn').textContent = 'Show derivation ▾';
    }
  });
  recompute();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wire);
} else {
  wire();
}
