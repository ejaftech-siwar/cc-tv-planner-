/* ============================================
   EJAF Technology – CCTV Planner  v3.0
   Full logic: Racks (EIA-310-D) + Central UPS
   + U-utilization bar + complete calculations
   ============================================ */
'use strict';

// ─────────────────── STATE ───────────────────
const state = {
  lang: 'ar',
  floors: [],
  cameras: { total: 0, indoor: 0, outdoor: 0 },
  racks: [],
  cables: { totalLength: 0, ipLength: 0, analogLength: 0 },
  labor: { totalHours: 0, totalDays: 0 },
  currentTool: 'camera',
  currentFloor: 0,
};

// ─────────────────── LANGUAGE ───────────────────
function toggleLang() {
  state.lang = state.lang === 'ar' ? 'en' : 'ar';
  document.documentElement.lang = state.lang;
  document.documentElement.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
  document.body.classList.toggle('lang-en', state.lang === 'en');
  document.getElementById('langLabel').textContent = state.lang === 'ar' ? 'English' : 'عربي';
  document.querySelectorAll('[data-ar]').forEach(el => {
    el.textContent = state.lang === 'ar' ? el.dataset.ar : el.dataset.en;
  });
}

// ─────────────────── TABS ───────────────────
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tabId).classList.add('active');
  document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
  if (tabId === 'cameras') refreshCameraSummary();
  if (tabId === 'report')  generateReport();
  if (tabId === 'floorplan') initFabricCanvas();
  if (tabId === 'labor')   calculateLabor();
  if (tabId === 'racks')   { updateRackDimensions(); updateUUtilBar(); }
}

// ─────────────────── FLOOR GENERATION ───────────────────
function generateFloorInputs() {
  const numFloors   = parseInt(document.getElementById('numFloors').value)   || 1;
  const numBasement = parseInt(document.getElementById('numBasement').value) || 0;
  const container   = document.getElementById('floorInputsContainer');
  state.floors = [];
  container.innerHTML = '';

  // header
  const hdr = document.createElement('div');
  hdr.className = 'floor-row floor-header';
  hdr.innerHTML = `
    <span>الطابق</span>
    <span>كاميرات داخلية</span>
    <span>كاميرات خارجية</span>
    <span>متوسط كابل (م) <span class="optional-tag">قابل للتعديل</span></span>
    <span>مجموعة الرك</span>
  `;
  container.appendChild(hdr);

  for (let b = numBasement; b >= 1; b--) addFloorRow(container, `B${b}`, `basement-${b}`);
  addFloorRow(container, 'G', 'floor-0');
  for (let f = 1; f < numFloors; f++) addFloorRow(container, `F${f}`, `floor-${f}`);

  updateFloorSelector();
  refreshCameraSummary();
}

function addFloorRow(container, label, id) {
  const row = document.createElement('div');
  row.className = 'floor-row';
  row.dataset.floorId = id;
  row.innerHTML = `
    <span class="floor-label">${label}</span>
    <input type="number" min="0" max="500" value="0" class="floor-indoor"   onchange="refreshCameraSummary()" />
    <input type="number" min="0" max="500" value="0" class="floor-outdoor"  onchange="refreshCameraSummary()" />
    <input type="number" min="5" max="500" value="50" step="5" class="floor-cable-len" />
    <input type="text"  class="floor-rack-group" value="${label}" style="font-family:var(--font-mono);font-size:12px;" />
  `;
  container.appendChild(row);
  state.floors.push({ id, label });
}

function getFloorData() {
  return Array.from(document.querySelectorAll('.floor-row[data-floor-id]')).map(row => ({
    id:        row.dataset.floorId,
    label:     row.querySelector('.floor-label').textContent,
    indoor:    parseInt(row.querySelector('.floor-indoor').value)    || 0,
    outdoor:   parseInt(row.querySelector('.floor-outdoor').value)   || 0,
    cableLen:  parseFloat(row.querySelector('.floor-cable-len').value) || 50,
    rackGroup: row.querySelector('.floor-rack-group').value || row.querySelector('.floor-label').textContent,
  }));
}

// ─────────────────── CAMERA SUMMARY ───────────────────
function refreshCameraSummary() {
  const data = getFloorData();
  let totalIndoor = 0, totalOutdoor = 0;
  data.forEach(f => { totalIndoor += f.indoor; totalOutdoor += f.outdoor; });
  const total = totalIndoor + totalOutdoor;
  state.cameras = { total, indoor: totalIndoor, outdoor: totalOutdoor };

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('totalCams',   total);
  set('indoorCams',  totalIndoor);
  set('outdoorCams', totalOutdoor);
  const nvrCh = parseInt((document.getElementById('nvrChannels') || {}).value) || 16;
  set('totalNVR', Math.ceil(total / nvrCh));
}

// ─────────────────── RACK DIMENSIONS (EIA-310-D / IEC 60297) ───────────────────
function updateRackDimensions() {
  const sel = document.getElementById('rackType');
  if (!sel) return;
  const opt = sel.options[sel.selectedIndex];
  const U     = opt.dataset.u    || '42';
  const H     = opt.dataset.h    || '2000';
  const W     = opt.dataset.w    || '600';
  const D     = opt.dataset.d    || '600';
  const load  = opt.dataset.load || '1000';
  // Usable U = total U minus 2U for PDU + 1U for cable mgmt top/bottom
  const usable = Math.max(0, parseInt(U) - 4);

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('dimU', U);
  set('dimH', H);
  set('dimW', W);
  set('dimD', D);
  set('dimLoad', load);
  set('dimUsable', usable + 'U');

  updateUUtilBar();
}

// ─────────────────── U UTILIZATION BAR ───────────────────
function updateUUtilBar() {
  const sel = document.getElementById('rackType');
  if (!sel) return;
  const opt = sel.options[sel.selectedIndex];
  const totalU = parseInt(opt.dataset.u) || 42;

  // Sum used U from rack items
  let usedU = 0;
  document.querySelectorAll('.rack-qty').forEach(inp => {
    const u  = parseInt(inp.closest('.rack-item')?.dataset?.u || inp.dataset.u || '1');
    const qty = parseInt(inp.value) || 0;
    usedU += u * qty;
  });

  const pct = Math.min(100, Math.round((usedU / totalU) * 100));
  const color = pct > 90 ? '#ff4d6d' : pct > 75 ? '#ffaa00' : '#00e5a0';

  const fill = document.getElementById('uBarFill');
  const text = document.getElementById('uUtilText');
  if (fill) { fill.style.width = pct + '%'; fill.style.background = color; }
  if (text) text.textContent = `${usedU} / ${totalU} U  (${pct}%)`;
}

// ─────────────────── UPS TOGGLE ───────────────────
function toggleUPSOptions() {
  const sys = document.getElementById('upsSystem').value;
  const perRack  = document.getElementById('perRackUPSOptions');
  const central  = document.getElementById('centralUPSOptions');
  if (!perRack || !central) return;
  perRack.style.display = sys === 'per-rack' ? 'block' : 'none';
  central.style.display = sys === 'central'  ? 'block' : 'none';
}

// ─────────────────── RACK CALCULATION ───────────────────
function calculateRacks() {
  refreshCameraSummary();
  const data        = getFloorData();
  const strategy    = document.getElementById('rackStrategy').value;
  const archiveDays = parseInt(document.getElementById('archiveDays').value) || 30;
  const nvrCh       = parseInt(document.getElementById('nvrChannels').value) || 16;
  const rackTypeSel = document.getElementById('rackType');
  const rackOpt     = rackTypeSel.options[rackTypeSel.selectedIndex];
  const totalU      = parseInt(rackOpt.dataset.u)    || 42;
  const rackH       = rackOpt.dataset.h || '?';
  const rackW       = rackOpt.dataset.w || '?';
  const rackD       = rackOpt.dataset.d || '?';
  const maxLoad     = rackOpt.dataset.load || '?';
  const rackLoc     = document.getElementById('rackLocation').value;
  const upsSys      = document.getElementById('upsSystem').value;

  // UPS details
  let upsLabel = '';
  let upsU = 0;
  if (upsSys === 'per-rack') {
    const upsCapSel = document.getElementById('upsCapacityPerRack');
    const upsOpt = upsCapSel.options[upsCapSel.selectedIndex];
    upsU = parseInt(upsOpt.dataset.u) || 2;
    const runtime = document.getElementById('upsRuntimePerRack').value;
    const brand   = document.getElementById('upsBrand').value;
    upsLabel = `${brand} – ${upsCapSel.value} VA – ${runtime} دقيقة – ${upsU}U`;
  } else if (upsSys === 'central') {
    const capSel  = document.getElementById('upsCapacityCentral');
    const runtime = document.getElementById('upsRuntimeCentral').value;
    const feed    = document.getElementById('upsCentralFeed').value;
    const brand   = document.getElementById('upsBrandCentral').value;
    upsLabel = `[مركزي] ${brand} – ${capSel.value} KVA – ${runtime} دقيقة – ${feed}`;
    upsU = 0; // not per rack
  } else {
    upsLabel = 'بدون UPS';
  }

  // Build rack groups
  let rackGroups = {};
  let floorCounter = 0;
  const n = strategy === 'per-2floors' ? 2 : strategy === 'per-3floors' ? 3 : strategy === 'per-5floors' ? 5 : 1;

  data.forEach((floor, idx) => {
    let groupKey;
    if (strategy === 'per-floor')   groupKey = floor.label;
    else if (strategy === 'central') groupKey = 'Central Rack';
    else if (strategy === 'custom')  groupKey = floor.rackGroup || floor.label;
    else {
      const grpIdx = Math.floor(idx / n) + 1;
      groupKey = `Group-${grpIdx}`;
    }
    if (!rackGroups[groupKey]) rackGroups[groupKey] = { floors: [], indoor: 0, outdoor: 0, label: groupKey };
    rackGroups[groupKey].floors.push(floor.label);
    rackGroups[groupKey].indoor  += floor.indoor;
    rackGroups[groupKey].outdoor += floor.outdoor;
  });

  const rackArr = Object.values(rackGroups);
  state.racks = rackArr;

  // Storage: H.265 ~ 0.75 GB/cam/day at 1080p (vs H.264 ~2 GB)
  const storagePerCamDay = 0.75;

  // Sum equipment U from rack items
  let equipU = 0;
  document.querySelectorAll('.rack-qty').forEach(inp => {
    const uPer = parseInt(inp.closest('.rack-item')?.dataset?.u || inp.dataset.u || '1');
    equipU += uPer * (parseInt(inp.value) || 0);
  });

  const container = document.getElementById('rackSummaryContent');

  // ── UPS summary banner ──
  let upsBanner = '';
  if (upsSys === 'central') {
    upsBanner = `
      <div class="ups-summary-central">
        <div class="ups-banner-icon">⚡</div>
        <div>
          <strong>UPS مركزي مشترك لجميع الركات</strong><br/>
          <span style="font-size:12px;color:var(--text-muted)">${upsLabel}</span>
        </div>
      </div>`;
  }

  let html = upsBanner + `<div class="rack-grid">`;

  rackArr.forEach((r, i) => {
    const cams    = r.indoor + r.outdoor;
    const nvrCnt  = Math.ceil(cams / nvrCh);
    const poeCnt  = Math.ceil(cams / 24);
    const storGB  = (cams * storagePerCamDay * archiveDays).toFixed(0);
    const storTB  = (cams * storagePerCamDay * archiveDays / 1000).toFixed(2);
    const nvrU    = nvrCnt * 2;
    const poeU    = poeCnt * 1;
    const upsUr   = upsSys === 'per-rack' ? upsU : 0;
    const usedU   = equipU + nvrU + upsUr;
    const freeU   = Math.max(0, totalU - usedU);
    const pct     = Math.min(100, Math.round((usedU / totalU) * 100));
    const barCol  = pct > 90 ? '#ff4d6d' : pct > 75 ? '#ffaa00' : '#00e5a0';

    html += `
      <div class="rack-card">
        <div class="rack-card-title">🗄️ Rack ${i + 1} — ${r.label}</div>
        <div class="rack-card-info">
          <div class="rci-row"><span class="rci-k">الطوابق</span><span class="rci-v">${r.floors.join(', ')}</span></div>
          <div class="rci-row"><span class="rci-k">إجمالي الكاميرات</span><span class="rci-v">${cams}</span></div>
          <div class="rci-row"><span class="rci-k">داخلية / خارجية</span><span class="rci-v">${r.indoor} / ${r.outdoor}</span></div>
          <div class="rci-row"><span class="rci-k">NVR (${nvrCh} ch)</span><span class="rci-v">${nvrCnt} جهاز × 2U = ${nvrU}U</span></div>
          <div class="rci-row"><span class="rci-k">PoE Switch 24p</span><span class="rci-v">${poeCnt} جهاز × 1U = ${poeU}U</span></div>
          ${upsSys === 'per-rack' ? `<div class="rci-row"><span class="rci-k">UPS (لكل رك)</span><span class="rci-v">${upsU}U – ${upsLabel}</span></div>` : ''}
          <div class="rci-row"><span class="rci-k">تخزين H.265</span><span class="rci-v">${storGB} GB ≈ ${storTB} TB</span></div>
          <div class="rci-row"><span class="rci-k">نوع الرك</span><span class="rci-v">${totalU}U – ${rackH}×${rackW}×${rackD} mm</span></div>
          <div class="rci-row"><span class="rci-k">حمولة قصوى</span><span class="rci-v">${maxLoad} kg</span></div>
          <div class="rci-row"><span class="rci-k">موقع</span><span class="rci-v">${rackLoc}</span></div>
        </div>
        <div class="u-util-bar" style="margin-top:10px">
          <div class="u-util-header">
            <span style="font-size:11px">U Utilization</span>
            <span style="font-size:11px;font-family:var(--font-mono)">${usedU}/${totalU}U (${pct}%) — ${freeU}U حر</span>
          </div>
          <div class="u-bar-bg"><div class="u-bar-fill" style="width:${pct}%;background:${barCol}"></div></div>
        </div>
      </div>
    `;
  });

  html += `</div>`;

  // Storage total
  const totalCams = state.cameras.total;
  const totalStorGB = (totalCams * storagePerCamDay * archiveDays).toFixed(0);
  const totalStorTB = (totalCams * storagePerCamDay * archiveDays / 1000).toFixed(2);

  html += `
    <div class="rack-totals-bar mt-15">
      <div class="rt-item"><span class="rt-k">إجمالي الركات</span><span class="rt-v">${rackArr.length}</span></div>
      <div class="rt-item"><span class="rt-k">إجمالي التخزين (H.265)</span><span class="rt-v">${totalStorGB} GB = ${totalStorTB} TB</span></div>
      <div class="rt-item"><span class="rt-k">معيار الرك</span><span class="rt-v">EIA-310-D / IEC 60297 — 19" (482.6 mm)</span></div>
      <div class="rt-item"><span class="rt-k">1U =</span><span class="rt-v">44.45 mm (1.75")</span></div>
      ${upsSys !== 'none' ? `<div class="rt-item"><span class="rt-k">UPS</span><span class="rt-v">${upsLabel}</span></div>` : ''}
    </div>
  `;

  container.innerHTML = html;
  updateUUtilBar();
}

// ─────────────────── CABLE CALCULATION ───────────────────
function calculateCables() {
  const data       = getFloorData();
  const wf         = (100 + (parseInt(document.getElementById('wasteFactor').value) || 15)) / 100;
  const ipType     = document.getElementById('ipCableType').value;
  const analogType = document.getElementById('analogCableType').value;
  const maxRun     = parseInt(document.getElementById('maxCableRun').value) || 100;
  let rows = [], totalIP = 0, totalAnalog = 0, warnings = [];

  data.forEach(floor => {
    if (floor.indoor + floor.outdoor === 0) return;
    const base      = floor.cableLen;
    const ipLen     = Math.round(floor.indoor  * base * wf);
    const analogLen = Math.round(floor.outdoor * base * wf);
    totalIP     += ipLen;
    totalAnalog += analogLen;
    if (base > maxRun) warnings.push(`⚠️ الطابق ${floor.label}: ${base}م يتجاوز الحد (${maxRun}م) — فكر بالألياف الضوئية`);
    rows.push({ floor: floor.label, indoor: floor.indoor, outdoor: floor.outdoor, ipLen, analogLen, base, warn: base > maxRun });
  });

  const totalAll = totalIP + totalAnalog;
  state.cables = { totalLength: totalAll, ipLength: totalIP, analogLength: totalAnalog };

  document.getElementById('cableSummaryContent').innerHTML = `
    <div class="cable-table-wrap">
      <table class="cable-table">
        <thead>
          <tr>
            <th>الطابق</th><th>داخلية</th><th>خارجية</th>
            <th>متوسط المسافة</th><th>${ipType} (م)</th>
            <th>${analogType} (م)</th><th>إجمالي الطابق</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr${r.warn ? ' style="background:rgba(255,170,0,0.07)"' : ''}>
              <td>${r.floor}${r.warn ? ' ⚠️' : ''}</td>
              <td>${r.indoor}</td><td>${r.outdoor}</td>
              <td>${r.base}م</td><td>${r.ipLen}م</td>
              <td>${r.analogLen}م</td><td>${r.ipLen + r.analogLen}م</td>
            </tr>`).join('')}
          <tr class="total-row">
            <td colspan="4">الإجمالي (شامل ${document.getElementById('wasteFactor').value}% هدر – TIA-568)</td>
            <td>${totalIP}م</td><td>${totalAnalog}م</td><td>${totalAll}م</td>
          </tr>
        </tbody>
      </table>
    </div>
    ${warnings.length ? `<div class="warn-box mt-10">${warnings.join('<br/>')}</div>` : ''}
    <div class="info-box mt-10">
      <div class="info-icon">📏</div>
      <div class="info-text">
        <strong>إجمالي: ${totalAll} م (${(totalAll/1000).toFixed(3)} كم)</strong> |
        IP: ${totalIP}م | Analog: ${totalAnalog}م<br/>
        TIA-568-C.2: الحد الأقصى لـ Cat6/6A = 100م. فوق ذلك: Fiber OM3/SM.
      </div>
    </div>`;
}

// ─────────────────── LABOR CALCULATION ───────────────────
function calculateLabor() {
  refreshCameraSummary();
  calculateCables();
  calculateRacks();

  const totalCams  = state.cameras.total;
  const totalCable = state.cables.totalLength || 0;
  const totalRacks = state.racks.length || 0;
  const team       = parseInt(document.getElementById('teamSize').value)        || 4;
  const hpd        = parseInt(document.getElementById('workHoursPerDay').value) || 8;
  const diff       = parseFloat(document.getElementById('difficultyLevel').value) || 1.2;
  const rInst      = parseFloat(document.getElementById('rateInstallCam').value)  || 1.5;
  const rCable     = parseFloat(document.getElementById('rateCablePull').value)   || 2;
  const rRack      = parseFloat(document.getElementById('rateRackInstall').value) || 4;
  const rConf      = parseFloat(document.getElementById('rateConfig').value)      || 0.5;

  const hInst  = totalCams * rInst * diff;
  const hCable = (totalCable / 100) * rCable * diff;
  const hRack  = totalRacks * rRack * diff;
  const hConf  = totalCams * rConf;
  const hMob   = 4;
  const hComm  = Math.max(4, totalCams * 0.1);
  const hTotal = hInst + hCable + hRack + hConf + hMob + hComm;
  const days   = Math.ceil(hTotal / (team * hpd));

  state.labor = { totalHours: Math.round(hTotal), totalDays: days };

  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s('totalHours',  Math.round(hTotal));
  s('totalDays',   days);
  s('installHours', Math.round(hInst));
  s('cableHours',  Math.round(hCable));
  s('configHours', Math.round(hConf));

  document.getElementById('laborBreakdownTable').innerHTML = `
    <table class="labor-table">
      <thead><tr><th>النشاط</th><th>الأساس</th><th>المعدل</th><th>الصعوبة</th><th>الساعات</th></tr></thead>
      <tbody>
        <tr><td>تركيب الكاميرات</td><td>${totalCams} كاميرا</td><td>${rInst}h/cam</td><td>×${diff}</td><td>${Math.round(hInst)} h</td></tr>
        <tr><td>مد الكابلات</td><td>${totalCable}م</td><td>${rCable}h/100م</td><td>×${diff}</td><td>${Math.round(hCable)} h</td></tr>
        <tr><td>تركيب الركات</td><td>${totalRacks} ركات</td><td>${rRack}h/رك</td><td>×${diff}</td><td>${Math.round(hRack)} h</td></tr>
        <tr><td>برمجة واختبار</td><td>${totalCams} كاميرا</td><td>${rConf}h/cam</td><td>–</td><td>${Math.round(hConf)} h</td></tr>
        <tr><td>تعبئة ونقل</td><td>–</td><td>–</td><td>–</td><td>${hMob} h</td></tr>
        <tr><td>تشغيل وتسليم</td><td>${totalCams} كاميرا</td><td>0.1h/cam</td><td>–</td><td>${Math.round(hComm)} h</td></tr>
        <tr style="color:var(--accent3);font-weight:700">
          <td>TOTAL</td>
          <td colspan="3">فريق ${team} × ${hpd}h/يوم</td>
          <td>${Math.round(hTotal)} h = <strong>${days} يوم</strong></td>
        </tr>
      </tbody>
    </table>`;
}

// ─────────────────── FLOOR PLAN (FABRIC.JS) ───────────────────
let fabricCanvas = null;
let canvasReady  = false;
let activeTool   = 'camera';

function initFabricCanvas() {
  if (canvasReady) return;
  canvasReady = true;
  const wrapper = document.querySelector('.canvas-wrapper');
  const el = document.getElementById('floorplanCanvas');
  el.width  = wrapper.clientWidth  || 900;
  el.height = 550;
  fabricCanvas = new fabric.Canvas('floorplanCanvas', { backgroundColor: '#07111f', selection: false });
  fabricCanvas.on('mouse:down', handleCanvasClick);
}

function setTool(tool) {
  activeTool = tool;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  const map = { camera: 'toolCamera', 'camera-outdoor': 'toolCameraOut', rack: 'toolRack', eraser: 'toolEraser', select: 'toolSelect' };
  if (map[tool]) document.getElementById(map[tool]).classList.add('active');
  if (fabricCanvas) fabricCanvas.selection = tool === 'select';
}

function handleCanvasClick(opt) {
  if (!fabricCanvas) return;
  const p = fabricCanvas.getPointer(opt.e);
  if (activeTool === 'eraser') { if (opt.target) { fabricCanvas.remove(opt.target); updateFPCount(); } return; }
  if (activeTool === 'select') return;
  const isOut = activeTool === 'camera-outdoor';
  const isRack = activeTool === 'rack';

  document.getElementById('canvasPlaceholder').classList.add('hidden');

  if (isRack) {
    const rect = new fabric.Rect({ width:30, height:30, fill:'rgba(167,139,250,0.15)', stroke:'#a78bfa', strokeWidth:2, left:p.x-15, top:p.y-15, selectable:true, hasControls:false, rx:3, ry:3, data:{type:'rack'} });
    const txt  = new fabric.Text('🗄️', { fontSize:18, left:p.x-11, top:p.y-13, selectable:false, evented:false });
    fabricCanvas.add(rect, txt);
  } else {
    const color = isOut ? '#ff7b00' : '#00c6ff';
    const icon  = isOut ? '🏠' : '📷';
    const circle = new fabric.Circle({ radius:13, fill:color+'22', stroke:color, strokeWidth:2, left:p.x-13, top:p.y-13, selectable:true, hasControls:false, data:{type: isOut ? 'outdoor':'indoor'} });
    const txt    = new fabric.Text(icon, { fontSize:14, left:p.x-9, top:p.y-11, selectable:false, evented:false });
    fabricCanvas.add(circle, txt);
  }
  fabricCanvas.renderAll();
  updateFPCount();
}

function updateFPCount() {
  const cams = fabricCanvas.getObjects().filter(o => o.data && (o.data.type === 'indoor' || o.data.type === 'outdoor'));
  document.getElementById('fpCamCount').textContent = cams.length;
}

function clearCanvas() {
  if (!fabricCanvas) return;
  fabricCanvas.clear(); fabricCanvas.backgroundColor = '#07111f'; fabricCanvas.renderAll();
  document.getElementById('canvasPlaceholder').classList.remove('hidden');
  document.getElementById('fpCamCount').textContent = '0';
}

function loadFloorplan(input) {
  const file = input.files[0]; if (!file) return;
  initFabricCanvas();
  document.getElementById('canvasPlaceholder').classList.add('hidden');
  if (file.type === 'application/pdf') {
    alert('ملف PDF: حوّله إلى صورة PNG/JPG للحصول على أفضل نتيجة على المخطط.'); return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    fabric.Image.fromURL(e.target.result, img => {
      const sx = fabricCanvas.getWidth()  / img.width;
      const sy = fabricCanvas.getHeight() / img.height;
      const sc = Math.min(sx, sy);
      img.set({ scaleX:sc, scaleY:sc, left:0, top:0, selectable:false, evented:false, opacity:0.85 });
      fabricCanvas.setBackgroundImage(img, fabricCanvas.renderAll.bind(fabricCanvas));
    });
  };
  reader.readAsDataURL(file);
}

function exportFloorplanPNG() {
  if (!fabricCanvas) return;
  const url = fabricCanvas.toDataURL({ format:'png', quality:1 });
  const a = document.createElement('a'); a.download = 'EJAF-floorplan.png'; a.href = url; a.click();
}

function updateFloorSelector() {
  const sel = document.getElementById('floorSelector'); if (!sel) return;
  sel.innerHTML = '';
  document.querySelectorAll('.floor-row[data-floor-id]').forEach(row => {
    const lbl = row.querySelector('.floor-label').textContent;
    const opt = document.createElement('option'); opt.value = row.dataset.floorId; opt.textContent = `الطابق ${lbl}`; sel.appendChild(opt);
  });
}

// ─────────────────── REPORT PREVIEW ───────────────────
function generateReport() {
  refreshCameraSummary(); calculateCables(); calculateRacks(); calculateLabor();
  const v = id => document.getElementById(id)?.value || '–';
  const pName = v('projectName'), cName = v('clientName'), date = v('projectDate');
  document.getElementById('rp-projectName').textContent = `تقرير مشروع: ${pName}`;
  document.getElementById('rp-meta').textContent = `العميل: ${cName} | التاريخ: ${date} | رقم: ${v('projectNumber')}`;

  const floorData = getFloorData().filter(f => f.indoor + f.outdoor > 0);
  const upsSys = document.getElementById('upsSystem').value;
  let upsInfo = 'بدون UPS';
  if (upsSys === 'per-rack') {
    upsInfo = `${v('upsBrand')} – ${document.getElementById('upsCapacityPerRack').value} VA – ${v('upsRuntimePerRack')} دقيقة/رك`;
  } else if (upsSys === 'central') {
    upsInfo = `[مركزي] ${v('upsBrandCentral')} – ${document.getElementById('upsCapacityCentral').value} KVA – ${v('upsRuntimeCentral')} دقيقة`;
  }

  const rackSel = document.getElementById('rackType');
  const rOpt = rackSel.options[rackSel.selectedIndex];
  const rackDims = `${rOpt.dataset.u}U – ${rOpt.dataset.h}×${rOpt.dataset.w}×${rOpt.dataset.d} mm – Max ${rOpt.dataset.load} kg`;

  document.getElementById('reportBody').innerHTML = `
    <div class="rp-section"><h4>📋 معلومات المشروع</h4>
      <table class="rp-table">
        <tr><th>اسم المشروع</th><td>${pName}</td><th>العميل</th><td>${cName}</td></tr>
        <tr><th>الموقع</th><td>${v('projectLocation')}</td><th>المهندس</th><td>${v('engineerName')}</td></tr>
        <tr><th>رقم المشروع</th><td>${v('projectNumber')}</td><th>التاريخ</th><td>${date}</td></tr>
        <tr><th>المعيار</th><td>${v('projectStandard')}</td><th>نوع المبنى</th><td>${v('buildingType')}</td></tr>
      </table>
    </div>
    <div class="rp-section"><h4>📷 الكاميرات</h4>
      <table class="rp-table">
        <tr><th>الإجمالي</th><th>داخلية</th><th>خارجية</th><th>البراند</th><th>الدقة</th><th>نظام التسجيل</th></tr>
        <tr><td><b>${state.cameras.total}</b></td><td>${state.cameras.indoor}</td><td>${state.cameras.outdoor}</td>
            <td>${v('cameraBrand')}</td><td>${v('defaultResolution')}</td><td>${v('recordingSystem')}</td></tr>
      </table>
    </div>
    <div class="rp-section"><h4>🏗️ تفصيل الطوابق</h4>
      <table class="rp-table">
        <tr><th>الطابق</th><th>داخلية</th><th>خارجية</th><th>الإجمالي</th><th>متوسط الكابل</th><th>مجموعة الرك</th></tr>
        ${floorData.map(f=>`<tr><td>${f.label}</td><td>${f.indoor}</td><td>${f.outdoor}</td><td>${f.indoor+f.outdoor}</td><td>${f.cableLen}م</td><td>${f.rackGroup}</td></tr>`).join('')}
        <tr style="font-weight:700;background:#f0f4f8"><td>الإجمالي</td><td>${state.cameras.indoor}</td><td>${state.cameras.outdoor}</td><td>${state.cameras.total}</td><td>–</td><td>${state.racks.length} ركات</td></tr>
      </table>
    </div>
    <div class="rp-section"><h4>🗄️ الركات والطاقة</h4>
      <table class="rp-table">
        <tr><th>عدد الركات</th><th>مواصفات الرك (EIA-310-D)</th><th>UPS</th><th>التخزين</th></tr>
        <tr><td>${state.racks.length}</td><td>${rackDims}</td><td>${upsInfo}</td>
            <td>${(state.cameras.total*0.75*(parseInt(v('archiveDays'))||30)/1000).toFixed(2)} TB (H.265)</td></tr>
      </table>
    </div>
    <div class="rp-section"><h4>🔌 الكابلات</h4>
      <table class="rp-table">
        <tr><th>IP Cable (${v('ipCableType')})</th><th>Analog (${v('analogCableType')})</th><th>الإجمالي</th><th>البراند</th><th>الهدر</th></tr>
        <tr><td>${state.cables.ipLength}م</td><td>${state.cables.analogLength}م</td><td><b>${state.cables.totalLength}م</b></td><td>${v('cableBrand')}</td><td>${v('wasteFactor')}%</td></tr>
      </table>
    </div>
    <div class="rp-section"><h4>👷 العمالة وأيام العمل</h4>
      <table class="rp-table">
        <tr><th>إجمالي الساعات</th><th>أيام العمل</th><th>الفريق</th><th>ساعات/يوم</th><th>معامل الصعوبة</th></tr>
        <tr><td>${state.labor.totalHours}h</td><td><b>${state.labor.totalDays} يوم</b></td>
            <td>${v('teamSize')} أفراد</td><td>${v('workHoursPerDay')}h</td><td>×${v('difficultyLevel')}</td></tr>
      </table>
    </div>
    <div style="margin-top:18px;padding:10px 14px;background:#f8fafc;border-radius:6px;border-right:4px solid #0a2540;font-size:11px;color:#666">
      تم الإعداد وفق: ${v('projectStandard')} · EIA-310-D · TIA-568-C.2 · IEC 62040-3 · IEEE 802.3af/at/bt<br/>
      جميع الأرقام تقديرية وتخضع للمراجعة الهندسية النهائية. © 2025 Ejaf Technology | Powered by Siwar
    </div>`;
}

// ─────────────────── PDF EXPORT ───────────────────
async function exportPDF(lang) {
  generateReport();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
  const v = id => document.getElementById(id)?.value || '–';
  const pName = v('projectName'), cName = v('clientName'), date = v('projectDate');
  const floorData = getFloorData().filter(f => f.indoor+f.outdoor > 0);

  // Header bar
  doc.setFillColor(10,37,64); doc.rect(0,0,210,32,'F');
  doc.setTextColor(0,198,255); doc.setFontSize(18); doc.setFont('helvetica','bold');
  doc.text('EJAF Technology', 14, 13);
  doc.setFontSize(9); doc.setTextColor(150,200,220);
  doc.text('CCTV Project Planner  |  Powered by Siwar', 14, 20);
  doc.text(`EIA-310-D · TIA-568 · IEC 62040-3 · EN 50132 · IEC 62676`, 14, 26);
  doc.setTextColor(255,255,255); doc.setFontSize(9);
  doc.text(`${pName}  |  ${cName}  |  ${date}`, 120, 13);
  doc.text(`Project No: ${v('projectNumber')}`, 120, 20);

  const autoT = (startY, head, body, foot) => {
    doc.autoTable({ startY, head, body, foot, theme:'striped',
      headStyles:{ fillColor:[10,37,64], textColor:[0,198,255], fontSize:8 },
      footStyles:{ fillColor:[220,235,250], fontStyle:'bold', fontSize:8 },
      styles:{ fontSize:8.5 }, margin:{ left:14, right:14 } });
    return doc.lastAutoTable.finalY + 6;
  };

  let y = 38;
  doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(0,0,0);
  doc.text('Project Information', 14, y); y += 2;
  y = autoT(y,[['Field','Value']],[
    ['Project Name', pName],['Client', cName],['Location', v('projectLocation')],
    ['Engineer', v('engineerName')],['Project No.', v('projectNumber')],['Date', date],
    ['Standard', v('projectStandard')],['Building Type', v('buildingType')],
  ]);

  doc.text('Camera Configuration', 14, y); y += 2;
  y = autoT(y,[['Total','Indoor','Outdoor','Brand','Resolution','Recording']],[[
    state.cameras.total, state.cameras.indoor, state.cameras.outdoor,
    v('cameraBrand'), v('defaultResolution'), v('recordingSystem')
  ]]);

  doc.text('Floor Details', 14, y); y += 2;
  y = autoT(y,
    [['Floor','Indoor','Outdoor','Total','Cable Avg (m)','Rack Group']],
    floorData.map(f=>[f.label, f.indoor, f.outdoor, f.indoor+f.outdoor, f.cableLen+'m', f.rackGroup]),
    [['TOTAL', state.cameras.indoor, state.cameras.outdoor, state.cameras.total,'–', state.racks.length+' racks']]
  );

  // Check page space
  if (y > 230) { doc.addPage(); y = 20; }
  doc.text('Racks, Cables & Labor', 14, y); y += 2;
  const rackSel = document.getElementById('rackType');
  const rOpt = rackSel.options[rackSel.selectedIndex];
  const upsSys = document.getElementById('upsSystem').value;
  let upsInfo = 'No UPS';
  if (upsSys==='per-rack') upsInfo = `${v('upsBrand')} – ${document.getElementById('upsCapacityPerRack').value}VA – ${v('upsRuntimePerRack')}min/rack`;
  else if (upsSys==='central') upsInfo = `[Central] ${v('upsBrandCentral')} – ${document.getElementById('upsCapacityCentral').value}KVA – ${v('upsRuntimeCentral')}min`;

  y = autoT(y,[['Category','Detail','Value']],[
    ['Racks', `EIA-310-D: ${rOpt.dataset.u}U – ${rOpt.dataset.h}×${rOpt.dataset.w}×${rOpt.dataset.d}mm`, state.racks.length+' racks'],
    ['UPS', upsSys, upsInfo],
    ['Storage (H.265)', `${v('archiveDays')} days archiving`, (state.cameras.total*0.75*(parseInt(v('archiveDays'))||30)/1000).toFixed(2)+' TB'],
    ['Cable – IP', v('ipCableType')+' | '+v('cableBrand'), state.cables.ipLength+'m'],
    ['Cable – Analog', v('analogCableType'), state.cables.analogLength+'m'],
    ['Cable – Total', 'incl. '+v('wasteFactor')+'% waste (TIA-568)', state.cables.totalLength+'m'],
    ['Labor – Hours', `Team: ${v('teamSize')} × ${v('workHoursPerDay')}h/day – Diff ×${v('difficultyLevel')}`, state.labor.totalHours+'h'],
    ['Labor – Days', '–', state.labor.totalDays+' workdays'],
  ]);

  // Footer all pages
  const pages = doc.internal.getNumberOfPages();
  for (let i=1;i<=pages;i++) {
    doc.setPage(i);
    doc.setFillColor(10,37,64); doc.rect(0,285,210,12,'F');
    doc.setTextColor(100,160,200); doc.setFontSize(7.5);
    doc.text('© 2025 Ejaf Technology – CCTV Planner | Powered by Siwar', 14, 292);
    doc.text(`Page ${i} / ${pages}`, 185, 292);
    doc.setTextColor(60,100,140);
    doc.text('IEC 62676 · EIA-310-D · TIA-568-C.2 · IEC 62040-3 · EN 50132', 80, 292);
  }

  doc.save(`EJAF-CCTV-${pName}-${lang.toUpperCase()}-${date}.pdf`);
}

// ─────────────────── EXCEL EXPORT ───────────────────
function exportExcel() {
  generateReport();
  const wb = XLSX.utils.book_new();
  const v = id => document.getElementById(id)?.value || '–';
  const floorData = getFloorData();
  const rackSel = document.getElementById('rackType');
  const rOpt = rackSel.options[rackSel.selectedIndex];
  const upsSys = document.getElementById('upsSystem').value;
  let upsInfo = 'No UPS';
  if (upsSys==='per-rack') upsInfo = `${v('upsBrand')} – ${document.getElementById('upsCapacityPerRack').value}VA – ${v('upsRuntimePerRack')}min`;
  else if (upsSys==='central') upsInfo = `[Central] ${v('upsBrandCentral')} – ${document.getElementById('upsCapacityCentral').value}KVA – ${v('upsRuntimeCentral')}min`;

  // S1: Project
  const s1 = XLSX.utils.aoa_to_sheet([
    ['EJAF Technology – CCTV Project Planner','','',''],
    ['Powered by Siwar','Standards: IEC 62676 · EIA-310-D · TIA-568 · IEC 62040-3','',''],
    [],
    ['Project Name', v('projectName'),'Client', v('clientName')],
    ['Location', v('projectLocation'),'Engineer', v('engineerName')],
    ['Project No.', v('projectNumber'),'Date', v('projectDate')],
    ['Building Type', v('buildingType'),'Standard', v('projectStandard')],
    ['Camera Brand', v('cameraBrand'),'Resolution', v('defaultResolution')],
    ['Recording System', v('recordingSystem'),'',''],
    [],
    ['CAMERA SUMMARY','','',''],
    ['Total','Indoor','Outdoor','NVR Count'],
    [state.cameras.total, state.cameras.indoor, state.cameras.outdoor, Math.ceil(state.cameras.total/(parseInt(v('nvrChannels'))||16))],
  ]);
  s1['!cols'] = [{wch:22},{wch:30},{wch:22},{wch:25}];
  XLSX.utils.book_append_sheet(wb, s1, 'Project Info');

  // S2: Floors
  const s2 = XLSX.utils.aoa_to_sheet([
    ['Floor','Indoor Cameras','Outdoor Cameras','Total','Cable Avg (m)','Rack Group'],
    ...floorData.map(f=>[f.label,f.indoor,f.outdoor,f.indoor+f.outdoor,f.cableLen,f.rackGroup]),
    ['TOTAL',state.cameras.indoor,state.cameras.outdoor,state.cameras.total,'–',state.racks.length+' racks'],
  ]);
  s2['!cols'] = [{wch:10},{wch:16},{wch:16},{wch:10},{wch:16},{wch:20}];
  XLSX.utils.book_append_sheet(wb, s2, 'Floor Details');

  // S3: Racks
  const s3 = XLSX.utils.aoa_to_sheet([
    ['Rack #','Group','Floors','Indoor','Outdoor','Total Cams','NVR','PoE Switch','HDD (TB)','U Used / Total','UPS'],
    ...state.racks.map((r,i)=>{
      const c=r.indoor+r.outdoor;
      const nvrCnt=Math.ceil(c/(parseInt(v('nvrChannels'))||16));
      const poe=Math.ceil(c/24);
      const hdd=(c*0.75*(parseInt(v('archiveDays'))||30)/1000).toFixed(2);
      return [i+1,r.label,r.floors.join(', '),r.indoor,r.outdoor,c,nvrCnt,poe,hdd,`${parseInt(rOpt.dataset.u)||42}U`,upsInfo];
    }),
    ['RACK SPECS (EIA-310-D / IEC 60297)',`${rOpt.dataset.u}U`,`H:${rOpt.dataset.h}mm`,`W:${rOpt.dataset.w}mm`,`D:${rOpt.dataset.d}mm`,`Max Load: ${rOpt.dataset.load}kg`,'1U=44.45mm','19" (482.6mm)','','',''],
  ]);
  s3['!cols'] = [{wch:8},{wch:15},{wch:20},{wch:10},{wch:10},{wch:12},{wch:8},{wch:12},{wch:10},{wch:14},{wch:35}];
  XLSX.utils.book_append_sheet(wb, s3, 'Racks & UPS');

  // S4: Cables
  const s4 = XLSX.utils.aoa_to_sheet([
    ['Floor','Indoor','Outdoor','Cable Avg (m)',`${v('ipCableType')} (m)`,`${v('analogCableType')} (m)`,'Total (m)'],
    ...floorData.filter(f=>f.indoor+f.outdoor>0).map(f=>{
      const wf=(100+(parseInt(v('wasteFactor'))||15))/100;
      const ip=Math.round(f.indoor*f.cableLen*wf);
      const an=Math.round(f.outdoor*f.cableLen*wf);
      return [f.label,f.indoor,f.outdoor,f.cableLen,ip,an,ip+an];
    }),
    ['TOTAL (incl. '+v('wasteFactor')+'% waste)',state.cameras.indoor,state.cameras.outdoor,'–',state.cables.ipLength,state.cables.analogLength,state.cables.totalLength],
    [],
    ['Cable Brand',v('cableBrand'),'Power',v('powerCableType'),'Max Run (m)',v('maxCableRun'),''],
    ['Standard','TIA-568-C.2','Max Cat6/6A','100m','Fiber for >100m','',''],
  ]);
  s4['!cols'] = [{wch:10},{wch:10},{wch:10},{wch:15},{wch:16},{wch:16},{wch:12}];
  XLSX.utils.book_append_sheet(wb, s4, 'Cables');

  // S5: Labor
  const diff=parseFloat(v('difficultyLevel'))||1.2, team=parseInt(v('teamSize'))||4, hpd=parseInt(v('workHoursPerDay'))||8;
  const rInst=parseFloat(v('rateInstallCam'))||1.5, rCable=parseFloat(v('rateCablePull'))||2;
  const rRack=parseFloat(v('rateRackInstall'))||4, rConf=parseFloat(v('rateConfig'))||0.5;
  const hInst=Math.round(state.cameras.total*rInst*diff);
  const hCable=Math.round((state.cables.totalLength/100)*rCable*diff);
  const hRack=Math.round(state.racks.length*rRack*diff);
  const hConf=Math.round(state.cameras.total*rConf);
  const s5 = XLSX.utils.aoa_to_sheet([
    ['Activity','Base','Rate','Difficulty','Hours'],
    ['Camera Installation',state.cameras.total+' cameras',rInst+'h/cam','×'+diff,hInst],
    ['Cable Pulling',state.cables.totalLength+'m',rCable+'h/100m','×'+diff,hCable],
    ['Rack Installation',state.racks.length+' racks',rRack+'h/rack','×'+diff,hRack],
    ['Config & Testing',state.cameras.total+' cameras',rConf+'h/cam','–',hConf],
    ['Mobilization','–','–','–',4],
    ['Commissioning','–','0.1h/cam','–',Math.max(4,Math.round(state.cameras.total*0.1))],
    ['TOTAL',`Team: ${team} × ${hpd}h/day`,'','',state.labor.totalHours],
    ['WORKDAYS','','','',state.labor.totalDays],
  ]);
  s5['!cols'] = [{wch:22},{wch:18},{wch:16},{wch:14},{wch:12}];
  XLSX.utils.book_append_sheet(wb, s5, 'Labor');

  XLSX.writeFile(wb, `EJAF-CCTV-${v('projectName')}-${v('projectDate')}.xlsx`);
}

// ─────────────────── INIT ───────────────────
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('projectDate').value = new Date().toISOString().slice(0,10);
  generateFloorInputs();
  updateRackDimensions();
  toggleUPSOptions();
  // Attach rack-qty live listeners for U-bar
  document.addEventListener('input', e => {
    if (e.target.classList.contains('rack-qty')) updateUUtilBar();
    if (e.target.id === 'rackType') updateRackDimensions();
  });
});

function updateCameraModels() {} // extensible
