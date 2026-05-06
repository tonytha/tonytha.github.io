// Purview AI PAYG Calculator - Customer-Empathy Edition
// Rates validated against Azure retail prices (prices.azure.com) Nov 2025.
// Per-customer note: 1 message ~= 1 text record (simplification).

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const fmt = n => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = n => Math.round(n).toLocaleString('en-US');

// All rates from Azure retail prices API (prices.azure.com), Microsoft Purview meters.
const RATES = {
  ccStandardPerKRecord: 0.30,    // Communication Compliance Standard: $0.30 / 1K text records
  ccPremiumPerKRecord: 0.50,     // Communication Compliance Premium:  $0.50 / 1K text records
  msgToTextRecords: 1.0,         // 1 message = 1 text record (per customer guidance)
  dlmPerMmsg: 0.00,              // Data Lifecycle Mgmt Premium: $0 in preview pricing
  auditPerMrec: 10.00,           // Audit Premium add-on: $0.01 / 1K records = $10 / 1M records
  msgToAuditRecords: 1.0,        // 1 message generates ~1 audit record
  dsiGBperMo: 4.80,              // DSI storage: $0.16 / GB-day = $4.80 / GB-mo
  dsiComputeHr: 5.00,            // DSI compute: $5.00 / hour
  edGBperMo: 20.10,              // eDiscovery Premium: $0.67 / GB-day = $20.10 / GB-mo
  irmPerMactivities: 2500.00,    // IRM (DSPU): $25 / 10K activities = $2,500 / 1M activities
  irmPremiumMultiplier: 2.0,     // Premium IRM tier ~2x activities/cost
};

// Persona -> messages/user/working-day
const PERSONA_MSGS_PER_DAY = { light: 5, typical: 20, heavy: 60 };
const WORKING_DAYS_PER_MONTH = 22;

// Compliance posture presets - bulk-set capability mode radios
const POSTURES = {
  'audit-only':    { cc: 'off',     dlm: 'off',     audit: 'standard', irm: 'off',      dsi: 'off', ed: 'off', samplingPct: 0,   retentionYrs: 1 },
  'standard':      { cc: 'premium', dlm: 'premium', audit: 'standard', irm: 'off',      dsi: 'off', ed: 'off', samplingPct: 20,  retentionYrs: 3 },
  'comprehensive': { cc: 'premium', dlm: 'premium', audit: 'premium',  irm: 'premium',  dsi: 'on',  ed: 'on',  samplingPct: 100, retentionYrs: 5 },
};

const DERIVATIONS = [];
function pushDeriv(label, expr, value) {
  DERIVATIONS.push({ label, expr, value });
}

function readModeRadio(name, fallback = 'off') {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : fallback;
}

function getPosture() {
  const el = document.querySelector('.posture-chip.active');
  return el ? el.dataset.posture : 'standard';
}

// Read each workload zone's monthly message volume from hidden inputs.
function readZones() {
  return {
    z1b: parseInt($('#z1b-msgs').value || '0', 10),
    z2:  parseInt($('#z2-msgs').value  || '0', 10),
    z3:  parseInt($('#z3-msgs').value  || '0', 10),
  };
}

// Sum of zones currently in scope of a capability via its scope checkboxes.
function inScopeMsgs(scopeName, vol) {
  const zones = $$(`input[name="${scopeName}"]:checked`).map(el => el.value);
  return zones.reduce((sum, z) => sum + (vol[z] || 0), 0);
}

function ccCost(vol) {
  const mode = readModeRadio('cc-mode', 'off');
  if (mode === 'off') return 0;
  const samplingPct = parseInt($('#cc-sampling').value || '20', 10);
  const msgs = inScopeMsgs('cc-scope', vol);
  const sampledMsgs = msgs * (samplingPct / 100);
  const records = sampledMsgs * RATES.msgToTextRecords;
  const ratePerK = (mode === 'premium') ? RATES.ccPremiumPerKRecord : RATES.ccStandardPerKRecord;
  const cost = (records / 1000) * ratePerK;
  pushDeriv(
    'Communication Compliance ' + (mode === 'premium' ? 'Premium' : 'Standard'),
    `${fmtInt(msgs)} msgs/mo &times; ${samplingPct}% sample &times; ${RATES.msgToTextRecords} record/msg @ ${fmt(ratePerK)}/1K records`,
    cost
  );
  return cost;
}

function dlmCost(vol) {
  const mode = readModeRadio('dlm-mode', 'off');
  if (mode === 'off' || mode === 'basic') return 0;
  const retentionYrs = parseInt($('#dlm-retention').value || '3', 10);
  const msgs = inScopeMsgs('dlm-scope', vol);
  const msgYears = msgs * 12 * retentionYrs / 1_000_000;
  const cost = msgYears * RATES.dlmPerMmsg;
  pushDeriv(
    'Data Lifecycle Mgmt Premium',
    `${fmtInt(msgs)} msgs/mo retained ${retentionYrs}yr &rArr; ${msgYears.toFixed(2)} M msg-yrs @ ${fmt(RATES.dlmPerMmsg)}/M (preview = free)`,
    cost
  );
  return cost;
}

function auditCost(vol) {
  const mode = readModeRadio('audit-mode', 'standard');
  if (mode === 'off' || mode === 'standard') return 0;
  // Audit Premium add-on charges only for non-M365 AI workloads (z2, z3 - not z1b).
  const msgs = (vol.z2 || 0) + (vol.z3 || 0);
  const records = msgs * RATES.msgToAuditRecords;
  const cost = (records / 1_000_000) * RATES.auditPerMrec;
  pushDeriv(
    'Audit Premium',
    `${fmtInt(msgs)} non-MS-Copilot msgs/mo &times; ${RATES.msgToAuditRecords} audit rec/msg @ ${fmt(RATES.auditPerMrec)}/M records`,
    cost
  );
  return cost;
}

function irmCost(vol) {
  const mode = readModeRadio('irm-mode', 'off');
  if (mode === 'off') return 0;
  // IRM activities derived from non-MS-Copilot AI workload volume; assume ~10% of msgs trigger IRM signal.
  const msgs = (vol.z2 || 0) + (vol.z3 || 0);
  const activities = msgs * 0.10 * (mode === 'premium' ? RATES.irmPremiumMultiplier : 1);
  const cost = (activities / 1_000_000) * RATES.irmPerMactivities;
  pushDeriv(
    'Insider Risk Management ' + (mode === 'premium' ? 'Premium' : 'Standard'),
    `${fmtInt(msgs)} non-MS-Copilot msgs &times; 10% trigger${mode === 'premium' ? ' &times; 2x premium' : ''} = ${fmtInt(activities)} activities @ ${fmt(RATES.irmPerMactivities)}/M`,
    cost
  );
  return cost;
}

function dsiCost() {
  const mode = readModeRadio('dsi-mode', 'off');
  if (mode === 'off') return 0;
  const gb = parseInt($('#dsi-gb').value || '0', 10);
  const units = parseInt($('#dsi-units').value || '0', 10);
  const storageCost = gb * RATES.dsiGBperMo;
  const computeCost = units * RATES.dsiComputeHr;
  const cost = storageCost + computeCost;
  pushDeriv(
    'Data Security Investigations',
    `${fmtInt(gb)} GB &times; ${fmt(RATES.dsiGBperMo)}/GB-mo + ${fmtInt(units)} compute-hr &times; ${fmt(RATES.dsiComputeHr)}/hr`,
    cost
  );
  return cost;
}

function edCost() {
  const mode = readModeRadio('ed-mode', 'off');
  if (mode === 'off') return 0;
  const gb = parseInt($('#ed-gb').value || '0', 10);
  const cost = gb * RATES.edGBperMo;
  pushDeriv(
    'eDiscovery Premium',
    `${fmtInt(gb)} GB &times; ${fmt(RATES.edGBperMo)}/GB-mo`,
    cost
  );
  return cost;
}

function enforceLicense() {
  const lic = $('#license').value || 'e5';
  const isE3 = lic === 'e3';
  $$('[data-e5-only]').forEach(el => {
    if (isE3) {
      el.classList.add('disabled');
      el.querySelectorAll('input, select, button').forEach(i => i.disabled = true);
      // Force E5-only caps off
      const offRadio = el.querySelector('input[type="radio"][value="off"]');
      if (offRadio && !offRadio.checked) offRadio.checked = true;
    } else {
      el.classList.remove('disabled');
      el.querySelectorAll('input, select, button').forEach(i => i.disabled = false);
    }
  });
  // Disable IRM Premium on E3
  const irmPrem = document.querySelector('input[name="irm-mode"][value="premium"]');
  if (irmPrem) irmPrem.disabled = isE3;
}

function applyPostureToCaps(posture) {
  const p = POSTURES[posture];
  if (!p) return;
  const setRadio = (name, val) => {
    const r = document.querySelector(`input[name="${name}"][value="${val}"]`);
    if (r && !r.disabled) r.checked = true;
  };
  setRadio('cc-mode',    p.cc);
  setRadio('dlm-mode',   p.dlm);
  setRadio('audit-mode', p.audit);
  setRadio('irm-mode',   p.irm);
  setRadio('dsi-mode',   p.dsi);
  setRadio('ed-mode',    p.ed);
  if ($('#cc-sampling'))  $('#cc-sampling').value  = p.samplingPct;
  if ($('#dlm-retention')) $('#dlm-retention').value = p.retentionYrs;
}

function recomputeWorkloadVolume(zone) {
  const card = document.querySelector(`[data-zone-card="${zone}"]`);
  if (!card) return;
  const toggle = card.querySelector('input[type="checkbox"][data-include]');
  const usersInput = card.querySelector(`input[data-users="${zone}"]`);
  const personaRadio = card.querySelector(`input[name="persona-${zone}"]:checked`);
  const hidden = $('#' + zone + '-msgs');
  if (!hidden) return;
  if (toggle && !toggle.checked) {
    hidden.value = '0';
    card.classList.add('zone-off');
    return;
  }
  card.classList.remove('zone-off');
  const users = Math.max(0, parseInt((usersInput && usersInput.value) || '0', 10));
  const persona = (personaRadio && personaRadio.value) || 'typical';
  const perDay = PERSONA_MSGS_PER_DAY[persona] || PERSONA_MSGS_PER_DAY.typical;
  const monthly = users * perDay * WORKING_DAYS_PER_MONTH;
  hidden.value = monthly;
  const out = card.querySelector(`[data-derived="${zone}"]`);
  if (out) out.textContent = fmtInt(monthly) + ' msgs/mo';
}

function recomputeAllZones() {
  ['z1b', 'z2', 'z3'].forEach(recomputeWorkloadVolume);
}

function recompute() {
  enforceLicense();
  recomputeAllZones();
  DERIVATIONS.length = 0;
  const vol = readZones();
  const cc = ccCost(vol);
  const dlm = dlmCost(vol);
  const audit = auditCost(vol);
  const irm = irmCost(vol);
  const dsi = dsiCost();
  const ed = edCost();
  const total = cc + dlm + audit + irm + dsi + ed;
  $('#total-payg').textContent = fmt(total) + '/mo';
  $('#total-ed').textContent = fmt(ed) + '/mo';
  // Per-cap chips
  const setChip = (id, val) => { const el = $(id); if (el) el.textContent = fmt(val); };
  setChip('#chip-cc', cc);
  setChip('#chip-dlm', dlm);
  setChip('#chip-audit', audit);
  setChip('#chip-irm', irm);
  setChip('#chip-dsi', dsi);
  setChip('#chip-ed', ed);
  // Re-render derivations drawer
  const list = $('#deriv-list');
  if (list) {
    list.innerHTML = '';
    DERIVATIONS.forEach(d => {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${d.label}</strong>: ${d.expr} = <span class="deriv-val">${fmt(d.value)}/mo</span>`;
      list.appendChild(li);
    });
    if (!DERIVATIONS.length) {
      list.innerHTML = '<li class="muted">No PAYG capabilities active. Pick a posture or enable a capability.</li>';
    }
  }
}

function wirePostureChips() {
  $$('.posture-chip').forEach(chip => {
    chip.addEventListener('click', e => {
      e.preventDefault();
      $$('.posture-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      applyPostureToCaps(chip.dataset.posture);
      recompute();
    });
  });
}

function wireWorkloadCards() {
  $$('[data-zone-card]').forEach(card => {
    const zone = card.dataset.zoneCard;
    card.querySelectorAll('input[type="checkbox"][data-include]').forEach(t => t.addEventListener('change', () => { recomputeWorkloadVolume(zone); recompute(); }));
    card.querySelectorAll(`input[data-users="${zone}"]`).forEach(i => i.addEventListener('input', () => { recomputeWorkloadVolume(zone); recompute(); }));
    card.querySelectorAll(`input[name="persona-${zone}"]`).forEach(r => r.addEventListener('change', () => { recomputeWorkloadVolume(zone); recompute(); }));
  });
}

function wireGenerics() {
  // Cap-mode radios + license + sampling + retention + cap inputs all trigger recompute
  $$('input[type="radio"], input[type="checkbox"], select, input[type="number"]').forEach(el => {
    if (el.dataset.include) return; // already wired in card handler
    if (el.dataset.users) return;
    if (el.name && el.name.startsWith('persona-')) return;
    el.addEventListener('change', recompute);
    if (el.type === 'number') el.addEventListener('input', recompute);
  });
  const reveal = $('#reveal-btn');
  if (reveal) reveal.addEventListener('click', () => {
    const drawer = $('#deriv-drawer');
    drawer.classList.toggle('open');
    reveal.textContent = drawer.classList.contains('open') ? 'Hide derivations' : 'Show derivations';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  wirePostureChips();
  wireWorkloadCards();
  wireGenerics();
  // Default posture: Standard
  const def = document.querySelector('.posture-chip[data-posture="standard"]');
  if (def) {
    $$('.posture-chip').forEach(c => c.classList.remove('active'));
    def.classList.add('active');
    applyPostureToCaps('standard');
  }
  recompute();
});
