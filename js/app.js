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

// ═══════════════════════════════════════════════
//  FIBER OPTIC MODULE — TIA-568.3-D / IEC 60793
// ═══════════════════════════════════════════════

let fiberScenario = 'intra';

function setFiberScenario(s) {
  fiberScenario = s;
  ['intra','inter','both'].forEach(x => {
    const btn = document.getElementById('scen' + x.charAt(0).toUpperCase() + x.slice(1));
    if (btn) btn.classList.toggle('active', x === s);
  });
  const intraEl = document.getElementById('fiberIntraSection');
  const interEl = document.getElementById('fiberInterSection');
  if (intraEl) intraEl.style.display = (s === 'intra' || s === 'both') ? 'block' : 'none';
  if (interEl) interEl.style.display = (s === 'inter' || s === 'both') ? 'block' : 'none';
  calcFiber();
}

function updateFiberSpecs() {
  const sel = document.getElementById('fiberType');
  if (!sel) return;
  const opt = sel.options[sel.selectedIndex];
  const atten = opt.dataset.atten || '–';
  const bw    = opt.dataset.bw    || '–';
  const dist  = parseInt(opt.dataset.dist) || 0;
  const isSM  = sel.value.startsWith('SM');
  const core  = isSM ? '9/125' : '50/125';
  const bwDisplay = bw === 'unlimited' ? '∞' : bw + ' MHz·km';
  const distDisplay = dist >= 1000 ? (dist/1000) + ' km' : dist + ' م';

  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s('fspecAtten', atten + ' dB/km');
  s('fspecBW',    bwDisplay);
  s('fspecDist',  distDisplay);
  s('fspecCore',  core + ' µm');
}

function addBuildingRun() {
  const c = document.getElementById('buildingRunsContainer');
  if (!c) return;
  const row = document.createElement('div');
  row.className = 'building-run-row';
  row.innerHTML = `
    <input type="text"   class="br-from" placeholder="من: مبنى" value="Building" />
    <span class="br-arrow">→</span>
    <input type="text"   class="br-to"   placeholder="إلى:" value="Building" />
    <input type="number" class="br-dist"  value="100" min="10" max="50000" onchange="calcFiber()" />
    <span class="br-unit">م</span>
    <button class="btn-icon-del" onclick="this.closest('.building-run-row').remove(); calcFiber()">✕</button>`;
  c.appendChild(row);
}

function calcFiber() {
  const fiberType  = document.getElementById('fiberType')?.value || 'SM-G652D';
  const cores      = document.getElementById('fiberCores')?.value || '12';
  const coresNum   = parseInt(cores) || 12;
  const waste      = 1 + (parseInt(document.getElementById('fiberWaste')?.value) || 15) / 100;
  const connector  = document.getElementById('fiberConnector')?.value || 'LC-APC';
  const spliceType = document.getElementById('spliceType')?.value || 'fusion';
  const spliceLoss = spliceType === 'fusion' ? 0.02 : 0.5;
  const connLoss   = connector.includes('APC') ? 0.1 : 0.3;
  const isAPC      = connector.includes('APC');

  // Attenuation from fiber type
  const fiberSel = document.getElementById('fiberType');
  const fOpt = fiberSel?.options[fiberSel.selectedIndex];
  const atten = parseFloat(fOpt?.dataset?.atten) || 0.35;

  let totalCableLen = 0;
  let runs = [];
  let totalSplicePoints = 0;

  // Intra-building
  if (fiberScenario === 'intra' || fiberScenario === 'both') {
    const racks = parseInt(document.getElementById('fiberIntraRacks')?.value) || 3;
    const dist  = parseFloat(document.getElementById('fiberIntraDist')?.value) || 60;
    const segments = racks - 1;
    const len = Math.round(dist * segments * waste);
    totalCableLen += len;
    totalSplicePoints += segments * 2; // 2 splices per segment
    runs.push({ label: `Backbone داخل المبنى (${segments} مقطع × ${dist}م)`, len, cores: coresNum, type: 'intra' });
  }

  // Inter-building
  if (fiberScenario === 'inter' || fiberScenario === 'both') {
    document.querySelectorAll('.building-run-row').forEach(row => {
      const from = row.querySelector('.br-from')?.value || 'A';
      const to   = row.querySelector('.br-to')?.value   || 'B';
      const dist = parseFloat(row.querySelector('.br-dist')?.value) || 100;
      const len  = Math.round(dist * waste);
      totalCableLen += len;
      totalSplicePoints += 4; // splice at both ends
      runs.push({ label: `${from} → ${to}`, len, cores: coresNum, type: 'inter', dist });
    });
  }

  // Auto-set splice points
  const spliceEl = document.getElementById('splicePoints');
  if (spliceEl && parseInt(spliceEl.value) === 0) spliceEl.value = totalSplicePoints;
  const spliceCount = parseInt(document.getElementById('splicePoints')?.value) || totalSplicePoints;

  // Patchcord auto-calc: 2 per ODF port used
  const patchcordEl = document.getElementById('patchcordQty');
  if (patchcordEl && parseInt(patchcordEl.value) === 0) patchcordEl.value = coresNum * runs.length * 2;
  const patchcordQty = parseInt(document.getElementById('patchcordQty')?.value) || 0;
  const pigtailQty   = spliceCount;

  // Pigtail auto
  const pigtailEl = document.getElementById('pigtailQty');
  if (pigtailEl && parseInt(pigtailEl.value) === 0) pigtailEl.value = spliceCount;

  // Splice sleeve auto
  const sleeveEl = document.getElementById('spliceSleeveQty');
  if (sleeveEl && parseInt(sleeveEl.value) === 0) sleeveEl.value = spliceCount;

  // Link Loss Budget per run
  const spliceMinutes = spliceCount * (parseInt(document.getElementById('spliceRateMin')?.value) || 15);
  const spliceHours = (spliceMinutes / 60).toFixed(1);

  // ODF count
  const odfType = document.getElementById('odfType')?.value || '1U-24';
  const odfPorts = parseInt(odfType.match(/(\d+)(?!U)/)?.[1]) || 24;
  const odfCount = Math.ceil((coresNum * runs.length) / odfPorts);

  // Loss Budget calc
  const maxDistKm = totalCableLen / 1000;
  const cableLoss = atten * maxDistKm;
  const totalLoss = (spliceCount * spliceLoss) + (patchcordQty * connLoss) + cableLoss;

  // OTDR test time: ~15min per km per direction
  const otdrTest  = document.getElementById('otdrTest')?.value || 'yes-both';
  const otdrHours = otdrTest === 'no' ? 0 : (otdrTest === 'yes-both' ? 2 : 1) * (maxDistKm * 0.25 * runs.length);

  // Labor hours for fiber
  const fiberLaborHours = parseFloat(spliceHours) + otdrHours + (runs.length * 2); // 2h prep/run

  // Save to state for reports
  state.fiber = { totalCableLen, coresNum, runs, spliceCount, odfCount, patchcordQty, totalLoss, fiberLaborHours, spliceHours, fiberType, connector };

  // Render results
  const container = document.getElementById('fiberResultsContent');
  if (!container) return;

  container.innerHTML = `
    <div class="stats-row">
      <div class="stat-box"><div class="stat-num" style="color:#a78bfa">${totalCableLen}</div><div class="stat-label">إجمالي الكابل (م)</div></div>
      <div class="stat-box"><div class="stat-num" style="color:#00e5a0">${spliceCount}</div><div class="stat-label">نقاط اللحام</div></div>
      <div class="stat-box"><div class="stat-num" style="color:#00c6ff">${odfCount}</div><div class="stat-label">عدد ODF</div></div>
      <div class="stat-box"><div class="stat-num" style="color:#ffaa00">${patchcordQty}</div><div class="stat-label">Patchcords</div></div>
      <div class="stat-box"><div class="stat-num" style="color:#ff7b00">${Math.round(fiberLaborHours)}</div><div class="stat-label">ساعات العمل</div></div>
    </div>

    <div class="cable-table-wrap mt-15">
      <table class="cable-table">
        <thead><tr><th>المسار</th><th>النوع</th><th>الكورات</th><th>الطول (م)</th><th>Loss Budget (dB)</th></tr></thead>
        <tbody>
          ${runs.map(r => {
            const runLoss = ((atten * r.len / 1000) + (2 * spliceLoss) + (2 * connLoss)).toFixed(2);
            return `<tr>
              <td>${r.label}</td>
              <td><span class="fiber-type-badge ${r.type}">${r.type === 'intra' ? 'داخلي' : 'Campus'}</span></td>
              <td>${r.cores}F</td>
              <td>${r.len}</td>
              <td>${runLoss} dB</td>
            </tr>`;
          }).join('')}
          <tr class="total-row">
            <td colspan="3">الإجمالي</td>
            <td>${totalCableLen} م</td>
            <td>${totalLoss.toFixed(2)} dB</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card-grid two-col mt-15">
      <div class="fiber-bom-card">
        <div class="fiber-bom-title">📦 Bill of Materials — Fiber</div>
        <div class="fiber-bom-row"><span>كابل فايبر ${fiberType}</span><span>${totalCableLen} م</span></div>
        <div class="fiber-bom-row"><span>ODF (${odfType})</span><span>${odfCount} قطعة</span></div>
        <div class="fiber-bom-row"><span>Pigtail (${connector})</span><span>${spliceCount} قطعة</span></div>
        <div class="fiber-bom-row"><span>Patchcord Duplex 2م</span><span>${patchcordQty} قطعة</span></div>
        <div class="fiber-bom-row"><span>Splice Sleeve 60mm</span><span>${spliceCount} قطعة</span></div>
        <div class="fiber-bom-row"><span>Splice Tray 12F</span><span>${Math.ceil(spliceCount/12)} قطعة</span></div>
      </div>
      <div class="fiber-bom-card">
        <div class="fiber-bom-title">⏱️ تقدير العمالة — Fiber Labor</div>
        <div class="fiber-bom-row"><span>لحام (${spliceCount} نقطة × ${document.getElementById('spliceRateMin')?.value || 15} دقيقة)</span><span>${spliceHours} ساعة</span></div>
        <div class="fiber-bom-row"><span>OTDR Test</span><span>${otdrHours.toFixed(1)} ساعة</span></div>
        <div class="fiber-bom-row"><span>تمديد وتثبيت الكابل</span><span>${(runs.length * 2).toFixed(0)} ساعة</span></div>
        <div class="fiber-bom-row total-bom-row"><span>إجمالي ساعات الفايبر</span><span>${Math.round(fiberLaborHours)} ساعة</span></div>
        <div class="info-box mt-10">
          <div class="info-icon">📋</div>
          <div class="info-text" style="font-size:11px">
            Link Loss Budget: <strong>${totalLoss.toFixed(2)} dB</strong><br/>
            Max Allowed (SM): 12 dB | Margin: ${(12 - totalLoss).toFixed(2)} dB
            ${totalLoss > 12 ? '<br/><span style="color:var(--danger)">⚠️ تجاوز الميزانية! راجع المسافات.</span>' : '<br/><span style="color:var(--accent3)">✓ ضمن الميزانية</span>'}
          </div>
        </div>
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════
//  NETWORK MODULE — IEEE 802.3 / TIA-942
// ═══════════════════════════════════════════════

function calcNetworkSwitches() {
  refreshCameraSummary();
  const totalCams  = state.cameras.total || 0;
  const poeSize    = parseInt(document.getElementById('poeSwitchSize')?.value) || 24;
  const poeBudget  = parseInt(document.getElementById('poeBudget')?.value) || 370;
  const poeStd     = document.getElementById('poeStandard')?.value || '802.3at';
  const bitrate    = parseInt(document.getElementById('camBitrate')?.value) || 3;
  const vlan       = document.getElementById('vlanEnabled')?.value || 'yes';
  const sfpType    = document.getElementById('sfpType')?.value || 'SFP-1G-LX';
  const sfpQty     = parseInt(document.getElementById('sfpQty')?.value) || 4;
  const coreBrand  = document.getElementById('coreSwitchBrand')?.value || '–';
  const poeBrand   = document.getElementById('poeSwitchBrand')?.value || '–';

  // PoE per camera (W)
  const poePerCam = poeStd === '802.3af' ? 12.95 : poeStd === '802.3at' ? 25.5 : 71;

  // Switch counts
  const poeSwitchCount = Math.ceil(totalCams / poeSize);
  const totalPoeLoad   = totalCams * poePerCam;

  // Bandwidth
  const totalBW   = totalCams * bitrate; // Mbps
  const uplinkBW  = Math.ceil(totalBW / 800) * 1000; // Next 1G/10G step

  // NVR channels → NVR count
  const nvrCh    = parseInt(document.getElementById('nvrChannels')?.value) || 16;
  const nvrCount = Math.ceil(totalCams / nvrCh);

  // Update topology display
  const topoNVR = document.getElementById('topoNVRCount');
  if (topoNVR) topoNVR.textContent = `${nvrCount} جهاز`;

  const topoDist = document.getElementById('topoDistribution');
  if (topoDist) {
    topoDist.innerHTML = state.racks.length > 0
      ? state.racks.map((r,i) => `<div class="topo-device dist-dev">🗄️ ${r.label}<br/><span>${r.indoor+r.outdoor} Cams</span></div>`).join('')
      : '<div class="topo-device dist-dev">🗄️ Floor Rack<br/><span>Distribution</span></div>';
  }

  const topoAccess = document.getElementById('topoAccess');
  if (topoAccess) {
    topoAccess.innerHTML = Array.from({length: Math.min(poeSwitchCount, 6)}, (_,i) =>
      `<div class="topo-device access-dev">🔌 PoE-SW${i+1}<br/><span>${poeSize}p ${poeStd.replace('802.3','')}</span></div>`
    ).join('') + (poeSwitchCount > 6 ? `<div class="topo-device access-dev">+${poeSwitchCount-6} more...</div>` : '');
  }

  // BW display
  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s('bwTotal',          totalBW + ' Mbps');
  s('bwUplink',         uplinkBW >= 1000 ? (uplinkBW/1000) + ' Gbps' : uplinkBW + ' Mbps');
  s('netPoeSwitchCount', poeSwitchCount);
  s('netSFPCount',       sfpQty + ' (مُدخل)');
  s('netPoeLoad',        totalPoeLoad.toFixed(0) + ' W');

  // Save state
  state.network = { poeSwitchCount, totalBW, uplinkBW, totalPoeLoad, nvrCount, sfpQty, coreBrand, poeBrand, poeStd, vlan };

  // Render summary
  const container = document.getElementById('networkSummaryContent');
  if (!container) return;

  const floorData = getFloorData().filter(f => f.indoor + f.outdoor > 0);

  container.innerHTML = `
    <div class="stats-row">
      <div class="stat-box"><div class="stat-num" style="color:#00c6ff">${poeSwitchCount}</div><div class="stat-label">PoE Switches</div></div>
      <div class="stat-box"><div class="stat-num" style="color:#a78bfa">${nvrCount}</div><div class="stat-label">NVR/DVR</div></div>
      <div class="stat-box"><div class="stat-num" style="color:#00e5a0">${totalBW}</div><div class="stat-label">Bandwidth (Mbps)</div></div>
      <div class="stat-box"><div class="stat-num" style="color:#ffaa00">${totalPoeLoad.toFixed(0)}</div><div class="stat-label">PoE Load (W)</div></div>
      <div class="stat-box"><div class="stat-num" style="color:#ff7b00">${sfpQty}</div><div class="stat-label">SFP Modules</div></div>
    </div>

    <div class="cable-table-wrap mt-15">
      <table class="cable-table">
        <thead><tr><th>الطابق/الزون</th><th>الكاميرات</th><th>PoE Switches</th><th>Bandwidth (Mbps)</th><th>PoE Load (W)</th></tr></thead>
        <tbody>
          ${floorData.map(f => {
            const cams = f.indoor + f.outdoor;
            const sw   = Math.ceil(cams / poeSize);
            const bw   = cams * bitrate;
            const load = (cams * poePerCam).toFixed(0);
            return `<tr><td>${f.label}</td><td>${cams}</td><td>${sw}</td><td>${bw}</td><td>${load} W</td></tr>`;
          }).join('')}
          <tr class="total-row">
            <td>TOTAL</td><td>${totalCams}</td><td>${poeSwitchCount}</td><td>${totalBW} Mbps</td><td>${totalPoeLoad.toFixed(0)} W</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card-grid two-col mt-15">
      <div class="fiber-bom-card">
        <div class="fiber-bom-title">📦 Network BOM</div>
        <div class="fiber-bom-row"><span>Core Switch (${coreBrand})</span><span>1 جهاز</span></div>
        <div class="fiber-bom-row"><span>PoE Access Switch ${poeSize}p (${poeBrand})</span><span>${poeSwitchCount} جهاز</span></div>
        <div class="fiber-bom-row"><span>SFP Module (${sfpType})</span><span>${sfpQty} وحدة</span></div>
        <div class="fiber-bom-row"><span>NVR/DVR (${nvrCh}ch)</span><span>${nvrCount} جهاز</span></div>
        <div class="fiber-bom-row"><span>VLAN للكاميرات</span><span>${vlan === 'yes' ? 'VLAN ' + (document.getElementById('vlanId')?.value || '100') : 'غير مفعّل'}</span></div>
      </div>
      <div class="fiber-bom-card">
        <div class="fiber-bom-title">📡 Network Standards</div>
        <div class="fiber-bom-row"><span>PoE Standard</span><span>${poeStd} (${poePerCam}W/port)</span></div>
        <div class="fiber-bom-row"><span>Switching Architecture</span><span>3-Tier (Core/Dist/Access)</span></div>
        <div class="fiber-bom-row"><span>Uplink Required</span><span>${uplinkBW >= 1000 ? (uplinkBW/1000) : uplinkBW} ${uplinkBW >= 1000 ? 'Gbps' : 'Mbps'}</span></div>
        <div class="fiber-bom-row"><span>Redundancy</span><span>IEEE 802.1D STP / RSTP</span></div>
        <div class="fiber-bom-row"><span>QoS</span><span>IEEE 802.1p (موصى للفيديو)</span></div>
      </div>
    </div>`;
}

// Hook into existing switchTab
const _origSwitchTab = switchTab;
// Re-define to add fiber/network hooks
window.switchTab = function(tabId) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tabId)?.classList.add('active');
  document.querySelector(`[data-tab="${tabId}"]`)?.classList.add('active');
  if (tabId === 'cameras')  refreshCameraSummary();
  if (tabId === 'report')   generateReport();
  if (tabId === 'floorplan') initFabricCanvas();
  if (tabId === 'labor')    calculateLabor();
  if (tabId === 'racks')    { updateRackDimensions(); updateUUtilBar(); }
  if (tabId === 'fiber')    { updateFiberSpecs(); calcFiber(); }
  if (tabId === 'network')  calcNetworkSwitches();
};

// Init fiber on DOM ready addition
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    updateFiberSpecs();
    setFiberScenario('both');
  }, 200);
});

// ═══════════════════════════════════════════════
//  VIDEO WALL + CONTROL ROOM MODULE
//  AVIXA / CEDIA · ISO 11064 · IEC 62676-4
// ═══════════════════════════════════════════════

// Screen physical sizes (inches → mm, bezel)
const SCREEN_SPECS = {
  46: { w: 1020, h: 574,  bezel: 3.5,  res: '1920×1080' },
  49: { w: 1086, h: 611,  bezel: 1.7,  res: '1920×1080' },
  55: { w: 1218, h: 686,  bezel: 1.7,  res: '1920×1080' },
  65: { w: 1440, h: 810,  bezel: 3.5,  res: '3840×2160' },
};

// AVIXA standard: viewer distance = screen height × 4–6 (surveillance)
const AVIXA_DIST_FACTOR = 4.5;

function updateDisplayCalc() {
  const cols      = parseInt(document.getElementById('vwCols')?.value) || 3;
  const rows      = parseInt(document.getElementById('vwRows')?.value) || 2;
  const sizeIn    = parseInt(document.getElementById('screenSize')?.value) || 55;
  const liveView  = parseInt(document.getElementById('liveViewCams')?.value) || 16;
  const totalScr  = cols * rows;

  // Update counter label
  const totalLbl = document.getElementById('vwTotalScreens');
  if (totalLbl) totalLbl.textContent = `= ${totalScr} شاشة`;

  // Physical wall dimensions
  const spec = SCREEN_SPECS[sizeIn] || SCREEN_SPECS[55];
  const wallW = ((spec.w + spec.bezel * 2) * cols) / 1000;
  const wallH = ((spec.h + spec.bezel * 2) * rows) / 1000;
  const wallArea = (wallW * wallH).toFixed(2);

  // AVIXA viewing distance
  const viewDist = ((spec.h / 1000) * AVIXA_DIST_FACTOR).toFixed(1);

  // Render grid preview
  const grid = document.getElementById('vwGrid');
  if (grid) {
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    grid.innerHTML = '';
    for (let i = 0; i < totalScr; i++) {
      const cell = document.createElement('div');
      cell.className = 'vw-cell';
      cell.textContent = `CAM`;
      grid.appendChild(cell);
    }
  }

  const dimsEl = document.getElementById('vwDims');
  if (dimsEl) dimsEl.textContent = `${wallW.toFixed(2)}م × ${wallH.toFixed(2)}م | ${wallArea}م² | مسافة المشاهدة: ${viewDist}م`;

  // Recommended layout calc (CCTV standard: 4 cams per screen max for surveillance)
  const camsPerScreen = 4;
  const recScreens = Math.ceil(liveView / camsPerScreen);
  const recCols = Math.ceil(Math.sqrt(recScreens * (16 / 9)));
  const recRows = Math.ceil(recScreens / recCols);
  const ctrlOutputs = cols * rows;

  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s('recLayout',   `${recCols} × ${recRows}`);
  s('recScreens',  `${recScreens} شاشة (${camsPerScreen} كاميرا/شاشة)`);
  s('recWallSize', `${wallW.toFixed(2)}م × ${wallH.toFixed(2)}م`);
  s('recCtrlOut',  `${ctrlOutputs} خرج (${cols}×${rows})`);

  // Save to state
  state.videowall = { cols, rows, totalScr, sizeIn, wallW, wallH, wallArea, viewDist, liveView, recScreens };
  calcControlRoom();
}

function calcControlRoom() {
  const operators  = parseInt(document.getElementById('operatorCount')?.value) || 2;
  const spacePerOp = parseInt(document.getElementById('spacePerOperator')?.value) || 5;
  const lighting   = document.getElementById('roomLighting')?.value || 'led-dim';
  const ac         = document.getElementById('roomAC')?.value || 'precision';
  const raisedFloor = document.getElementById('raisedFloor')?.value || 'yes';
  const accessCtrl = document.getElementById('accessControl')?.value || 'card';
  const fire       = document.getElementById('fireSuppression')?.value || 'clean-agent';
  const secLevel   = document.getElementById('securityLevel')?.value || '2';
  const roomLoc    = document.getElementById('roomLocation')?.value || 'basement';
  const totalCams  = state.cameras?.total || 0;
  const vw         = state.videowall || { totalScr: 6, wallW: 3.7, wallH: 1.5, sizeIn: 55, viewDist: 3.1, liveView: 16 };

  // ISO 11064 room sizing
  const minRoomArea  = operators * spacePerOp;
  // Add: VW wall clearance (2m front) + rack space (1.5m rear) + aisle (1.2m)
  const vwClearance  = parseFloat(vw.wallW || 3.7) + 2.0;
  const totalRoomArea = Math.max(minRoomArea, Math.ceil(vwClearance * (operators * 1.5 + 2)));
  const recRoomW     = (vw.wallW + 2).toFixed(1);
  const recRoomD     = (parseFloat(vw.viewDist || 3.1) + 1.5).toFixed(1);

  // AC load estimate: 200W per screen + 500W per workstation + rack heat
  const rackCount    = state.racks?.length || 1;
  const acLoad       = (vw.totalScr * 200 + operators * 500 + rackCount * 300) / 1000; // kW
  const acTons       = (acLoad * 0.2843).toFixed(1); // 1 kW = 0.2843 TR

  // Lighting lux recommendation (EN 12464-1)
  const luxRec = secLevel >= '3' ? '200–300 lux' : '300–500 lux';

  // Cable estimate for control room
  const hdmiCables = vw.totalScr;
  const powerOutlets = operators * 4 + vw.totalScr * 2;

  // Save
  state.controlRoom = { operators, totalRoomArea, acLoad, acTons, recRoomW, recRoomD, hdmiCables };

  const container = document.getElementById('controlRoomContent');
  if (!container) return;

  container.innerHTML = `
    <div class="stats-row">
      <div class="stat-box"><div class="stat-num" style="color:#00c6ff">${totalRoomArea}</div><div class="stat-label">مساحة الغرفة (م²)</div></div>
      <div class="stat-box"><div class="stat-num" style="color:#a78bfa">${operators}</div><div class="stat-label">محطات عمل</div></div>
      <div class="stat-box"><div class="stat-num" style="color:#00e5a0">${acLoad.toFixed(1)}</div><div class="stat-label">حمل التبريد (kW)</div></div>
      <div class="stat-box"><div class="stat-num" style="color:#ffaa00">${acTons}</div><div class="stat-label">تكييف مطلوب (TR)</div></div>
      <div class="stat-box"><div class="stat-num" style="color:#ff7b00">${vw.totalScr}</div><div class="stat-label">شاشات Video Wall</div></div>
    </div>

    <div class="card-grid two-col mt-15">
      <div class="cr-spec-card">
        <div class="cr-spec-title">📐 أبعاد الغرفة الموصى — ISO 11064</div>
        <div class="cr-spec-row"><span>المساحة الدنيا</span><span>${minRoomArea} م²</span></div>
        <div class="cr-spec-row"><span>المساحة الموصى</span><span>${totalRoomArea} م²</span></div>
        <div class="cr-spec-row"><span>العرض الموصى</span><span>${recRoomW} م (يتسع للجدار ${parseFloat(vw.wallW).toFixed(1)}م + 2م أمام)</span></div>
        <div class="cr-spec-row"><span>العمق الموصى</span><span>${recRoomD} م (مسافة مشاهدة ${vw.viewDist}م + مكاتب)</span></div>
        <div class="cr-spec-row"><span>ارتفاع السقف الموصى</span><span>2.7م – 3.0م (مع Raised Floor)</span></div>
        <div class="cr-spec-row"><span>مسافة المشاهدة (AVIXA)</span><span>${vw.viewDist}م من الجدار</span></div>
        <div class="cr-spec-row"><span>ارتفاع Video Wall عن الأرض</span><span>0.9م – 1.0م (مركز العين)</span></div>
      </div>
      <div class="cr-spec-card">
        <div class="cr-spec-title">⚡ البنية التحتية للغرفة</div>
        <div class="cr-spec-row"><span>تكييف مطلوب</span><span>${acLoad.toFixed(1)} kW = ${acTons} TR — ${ac === 'precision' ? 'Precision AC ✓' : ac}</span></div>
        <div class="cr-spec-row"><span>الإضاءة</span><span>${luxRec} — ${lighting === 'led-dim' ? 'LED قابلة للتعتيم ✓' : lighting}</span></div>
        <div class="cr-spec-row"><span>أرضية مرفوعة</span><span>${raisedFloor === 'yes' ? '✓ 600×600mm Panels (موصى)' : '✗ Cable Tray'}</span></div>
        <div class="cr-spec-row"><span>Access Control</span><span>${accessCtrl === 'biometric' ? 'Biometric (بصمة+بطاقة) ✓' : accessCtrl}</span></div>
        <div class="cr-spec-row"><span>إطفاء حريق</span><span>${fire === 'clean-agent' ? 'Clean Agent FM-200/Novec ✓' : fire}</span></div>
        <div class="cr-spec-row"><span>مخارج كهربائية</span><span>${powerOutlets} مخرج (${operators}× مكتب + شاشات)</span></div>
        <div class="cr-spec-row"><span>مستوى الأمان</span><span>Level ${secLevel} — ${['','تجاري','مؤسسي','حكومي','عسكري'][parseInt(secLevel)]}</span></div>
      </div>
    </div>

    <div class="info-box mt-15">
      <div class="info-icon">📋</div>
      <div class="info-text" style="font-size:12px;line-height:1.8">
        <strong>معايير مُطبّقة:</strong>
        ISO 11064 (Ergonomic Control Room Design) |
        AVIXA (Viewing Distance = Screen Height × 4.5) |
        EN 12464-1 (Lighting ${luxRec}) |
        ASHRAE (تبريد: ${acLoad.toFixed(1)} kW) |
        NFPA 72 (إنذار الحريق) |
        ${fire === 'clean-agent' ? 'NFPA 2001 (Clean Agent Suppression)' : ''}
      </div>
    </div>`;

  // Equipment BOM
  renderVWEquipment();
}

function renderVWEquipment() {
  const vw          = state.videowall || {};
  const cr          = state.controlRoom || {};
  const totalCams   = state.cameras?.total || 0;
  const controllers = 1;
  const matrixVal   = document.getElementById('matrixSwitch')?.value || 'none';
  const cableType   = document.getElementById('displayCableType')?.value || 'IP-HDBaseT';
  const brand       = document.getElementById('displayBrand')?.value || '–';
  const ctrlBrand   = document.getElementById('vwControllerType')?.value || '–';
  const operators   = cr.operators || 2;
  const totalScr    = vw.totalScr || 6;
  const sizeIn      = vw.sizeIn || 55;
  const hdmiCables  = totalScr;
  const opMonitors  = operators * 2; // 2 monitors per operator workstation

  const container = document.getElementById('vwEquipContent');
  if (!container) return;

  container.innerHTML = `
    <div class="card-grid two-col">
      <div class="fiber-bom-card">
        <div class="fiber-bom-title">📺 معدات Video Wall</div>
        <div class="fiber-bom-row"><span>${sizeIn}" Display Panel (${brand})</span><span>${totalScr} قطعة</span></div>
        <div class="fiber-bom-row"><span>Video Wall Controller (${ctrlBrand})</span><span>${controllers} جهاز</span></div>
        ${matrixVal !== 'none' ? `<div class="fiber-bom-row"><span>Matrix Switch (${matrixVal})</span><span>1 جهاز</span></div>` : ''}
        <div class="fiber-bom-row"><span>كابل توصيل (${cableType})</span><span>${hdmiCables} قطعة</span></div>
        <div class="fiber-bom-row"><span>Wall Mounting Brackets</span><span>${totalScr} قطعة</span></div>
        <div class="fiber-bom-row"><span>Power Strip للشاشات</span><span>${Math.ceil(totalScr / 6)} قطعة</span></div>
      </div>
      <div class="fiber-bom-card">
        <div class="fiber-bom-title">🖥️ محطات العمل</div>
        <div class="fiber-bom-row"><span>Operator Workstation</span><span>${operators} محطة</span></div>
        <div class="fiber-bom-row"><span>Monitor 27" (مشغّل)</span><span>${opMonitors} شاشة (${operators}×2)</span></div>
        <div class="fiber-bom-row"><span>KVM Switch</span><span>${operators > 2 ? Math.ceil(operators / 4) : 1} جهاز</span></div>
        <div class="fiber-bom-row"><span>Keyboard + Mouse</span><span>${operators} طقم</span></div>
        <div class="fiber-bom-row"><span>Headset / Intercom</span><span>${operators} جهاز</span></div>
        <div class="fiber-bom-row"><span>Operator Desk</span><span>${operators} طاولة</span></div>
      </div>
      <div class="fiber-bom-card">
        <div class="fiber-bom-title">🏛️ البنية التحتية للغرفة</div>
        <div class="fiber-bom-row"><span>Precision AC Unit</span><span>${Math.ceil(cr.acLoad / 5)} وحدة (${cr.acTons} TR)</span></div>
        <div class="fiber-bom-row"><span>Raised Floor Panels 600×600</span><span>${Math.ceil(cr.totalRoomArea / 0.36)} لوح</span></div>
        <div class="fiber-bom-row"><span>LED Dimmable Lighting</span><span>${Math.ceil(cr.totalRoomArea / 4)} وحدة</span></div>
        <div class="fiber-bom-row"><span>Access Control Reader</span><span>2 قطعة (دخول/خروج)</span></div>
        <div class="fiber-bom-row"><span>Fire Detector (Optical)</span><span>${Math.ceil(cr.totalRoomArea / 30)} كاشف</span></div>
        <div class="fiber-bom-row"><span>Emergency Exit Sign</span><span>2 قطعة</span></div>
      </div>
      <div class="fiber-bom-card">
        <div class="fiber-bom-title">📡 معايير التصميم المطبّقة</div>
        <div class="fiber-bom-row"><span>تخطيط الغرفة</span><span>ISO 11064-3</span></div>
        <div class="fiber-bom-row"><span>مسافة المشاهدة</span><span>AVIXA M301.01 (×4.5H)</span></div>
        <div class="fiber-bom-row"><span>الإضاءة</span><span>EN 12464-1 / IES RP-1</span></div>
        <div class="fiber-bom-row"><span>الصوتيات</span><span>NC-35 (Noise Criterion)</span></div>
        <div class="fiber-bom-row"><span>التبريد</span><span>ASHRAE 55 / ANSI/TIA-942</span></div>
        <div class="fiber-bom-row"><span>الأمان</span><span>IEC 62676-4 / EN 50132-7</span></div>
      </div>
    </div>`;
}

// Hook videowall into switchTab
const _sw2 = window.switchTab;
window.switchTab = function(tabId) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tabId)?.classList.add('active');
  document.querySelector(`[data-tab="${tabId}"]`)?.classList.add('active');
  if (tabId === 'cameras')   refreshCameraSummary();
  if (tabId === 'report')    generateReport();
  if (tabId === 'floorplan') initFabricCanvas();
  if (tabId === 'labor')     calculateLabor();
  if (tabId === 'racks')     { updateRackDimensions(); updateUUtilBar(); }
  if (tabId === 'fiber')     { updateFiberSpecs(); calcFiber(); }
  if (tabId === 'network')   calcNetworkSwitches();
  if (tabId === 'videowall') { updateDisplayCalc(); calcControlRoom(); }
};

// Init on load
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => { updateDisplayCalc(); }, 300);
});

// ═══════════════════════════════════════════════
//  PHASE 3 — Enhanced Camera Models + Full Export
// ═══════════════════════════════════════════════

// ── Camera model series per brand ──
const CAMERA_MODELS = {
  'Axis':            { series: ['P-Series (Fixed Dome)','Q-Series (PTZ/Multi)','M-Series (Entry)','FA-Series (Modular)','F-Series (Pinhole)'], codec: 'H.265/H.264/MJPEG', chip: 'ARTPEC-8' },
  'Bosch':           { series: ['FLEXIDOME 5100i','FLEXIDOME 3000i','MIC IP starlight','DINION 5100i','Autodome IP 7000i'], codec: 'H.265/H.264', chip: 'INTEOX' },
  'Hikvision':       { series: ['DS-2CD2xx7 AcuSense','DS-2CD3xx7 Deep Learning','DS-2DE4xxx PTZ','DS-2TD Thermal','DS-2DF8 Speed Dome'], codec: 'H.265+/H.264+', chip: 'Hikvision DarkFighter' },
  'Dahua':           { series: ['IPC-HDW2xxx WizSense','IPC-HFW3xxx','IPC-HDW5xxx AI','TPC Thermal','SD49xx-HNR PTZ'], codec: 'H.265+/H.264+', chip: 'Ambarella H22' },
  'Hanwha':          { series: ['QNV-8xxx Wisenet X','XNV-9xxx 4K','QNO-8xxx Bullet','QNF-9xxx Fisheye','QNP-9xxx PTZ'], codec: 'H.265/H.264', chip: 'Wisenet 7' },
  'Avigilon':        { series: ['H6SL Dome','H5A Bullet','H4 PTZ','H4 Thermal','H4 LPR'], codec: 'H.265/H.264', chip: 'Self-Learning Video' },
  'Sony':            { series: ['SNC-VB770','SNC-EM630','SSC-YB411','SNC-VM772R','SNC-WR630'], codec: 'H.265/H.264/JPEG', chip: 'BIONZ X' },
  'Uniview':         { series: ['IPC3614xx','IPC3618xx 4K','IPC672x AI','IPC9312-AF28-WL','DS-2DE7xx PTZ'], codec: 'H.265/H.264', chip: 'Novatek NT98562' },
  'Tiandy':          { series: ['TC-C32QN','TC-C38WQ 8MP','TC-C64WA AI','TC-PTZ8000','TC-C54WP'], codec: 'H.265+/H.264+', chip: 'Ambarella' },
  'Milesight':       { series: ['MS-C2961','MS-C5361','MS-C8163','MS-C9674 4K','MS-N PTZ'], codec: 'H.265/H.264', chip: 'HiSilicon' },
  'CP-Plus':         { series: ['CP-UNC-DA21L3','CP-UNC-TA81L3-MDS','CP-USC-FC51ZL3','CP-VCG-IK50 Analog','CP-UPT-E75 PTZ'], codec: 'H.265/H.264', chip: 'Ambarella S5L' },
  'Vivotek':         { series: ['IB9365-EHT','FD9365-EHTV','MS9321-EHV 12MP','SD9384-EHL PTZ','VC8201-HMOD 180°'], codec: 'H.265/H.264', chip: 'VIVOTEK VVTK-1100' },
  'Flir':            { series: ['Quasar SR','Elara FB-Series Thermal','Ariel SV','Saros DH-390','Quasar 4K'], codec: 'H.265/H.264', chip: 'FLIR Lepton' },
  'Mobotix':         { series: ['M73 Dual Lens','Q71 360°','P71 PTZ','S74 Modular','D71 Dome'], codec: 'H.264/MxPEG', chip: 'MOBOTIX MxBus' },
  'Pelco':           { series: ['Sarix IMP Series','Spectra Enhanced PTZ','S-Series Dome','C4DN Bullet','DF5-PG-E'], codec: 'H.265/H.264', chip: 'Pelco SureVision' },
  'Reolink':         { series: ['RLC-810A','RLC-823A','RLC-842A 4K','E1 Pro','Duo 3 PoE'], codec: 'H.265/H.264', chip: 'HiSilicon' },
  'Vigi':            { series: ['C540 4MP','C340 4MP','C540V Varifocal','C540WB WDR','C340WS'], codec: 'H.265/H.264', chip: 'HiSilicon' },
  'FLIR-Thermal':    { series: ['FC-Series S Thermal','A310 Fixed','FC-645 PTZ Thermal','A70 Advanced'], codec: 'H.264/RTSP', chip: 'FLIR Lepton 3.5' },
  'Hikvision-Thermal': { series: ['DS-2TD2117-3/PA','DS-2TD2136T-6/P','DS-2TD4137-25/W PTZ','DS-2TX3346-25P Bi-Spectrum'], codec: 'H.265/H.264', chip: 'DarkFighter+Thermal' },
};

// Override updateCameraModels with full implementation
window.updateCameraModels = function() {
  const brand = document.getElementById('cameraBrand')?.value;
  if (!brand) return;
  const modelData = CAMERA_MODELS[brand];
  if (!modelData) return;

  // Update or create model info display
  let infoEl = document.getElementById('cameraModelInfo');
  if (!infoEl) {
    infoEl = document.createElement('div');
    infoEl.id = 'cameraModelInfo';
    infoEl.className = 'cam-model-info';
    const brandSelect = document.getElementById('cameraBrand');
    brandSelect?.closest('.form-group')?.after(infoEl);
  }

  infoEl.innerHTML = `
    <div class="cmi-header">${brand} — Series & Models</div>
    <div class="cmi-chip">Chip: <span>${modelData.chip}</span> | Codec: <span>${modelData.codec}</span></div>
    <div class="cmi-series">
      ${modelData.series.map(s => `<span class="cmi-badge">${s}</span>`).join('')}
    </div>`;
};

// ── Full generateReport with scope selectors ──
window.generateReport = function() {
  refreshCameraSummary();
  calculateCables();
  calculateRacks();
  calculateLabor();

  const sc = id => document.getElementById(id)?.checked !== false; // default true
  const v  = id => document.getElementById(id)?.value || '–';
  const pName = v('projectName'), cName = v('clientName'), date = v('projectDate');

  document.getElementById('rp-projectName').textContent = `تقرير مشروع: ${pName}`;
  document.getElementById('rp-meta').textContent = `العميل: ${cName} | التاريخ: ${date} | رقم: ${v('projectNumber')}`;

  const floorData = getFloorData().filter(f => f.indoor + f.outdoor > 0);
  const upsSys = v('upsSystem');
  let upsInfo = 'بدون UPS';
  if (upsSys === 'per-rack') upsInfo = `${v('upsBrand')} – ${document.getElementById('upsCapacityPerRack')?.value || '–'} VA / رك`;
  else if (upsSys === 'central') upsInfo = `[مركزي] ${v('upsBrandCentral')} – ${document.getElementById('upsCapacityCentral')?.value || '–'} KVA`;

  const rackSel = document.getElementById('rackType');
  const rOpt = rackSel?.options[rackSel?.selectedIndex];
  const rackDims = rOpt ? `${rOpt.dataset.u}U – ${rOpt.dataset.h}×${rOpt.dataset.w}×${rOpt.dataset.d}mm` : '–';

  // Fiber summary
  const fb = state.fiber || {};
  const nw = state.network || {};
  const vw = state.videowall || {};
  const cr = state.controlRoom || {};

  let html = '';

  if (sc('rsc-project')) html += `
    <div class="rp-section"><h4>📋 معلومات المشروع / Project Information</h4>
      <table class="rp-table">
        <tr><th>اسم المشروع</th><td>${pName}</td><th>Client</th><td>${cName}</td></tr>
        <tr><th>الموقع</th><td>${v('projectLocation')}</td><th>Engineer</th><td>${v('engineerName')}</td></tr>
        <tr><th>رقم المشروع</th><td>${v('projectNumber')}</td><th>Date</th><td>${date}</td></tr>
        <tr><th>المعيار</th><td>${v('projectStandard')}</td><th>نوع المبنى</th><td>${v('buildingType')}</td></tr>
      </table></div>`;

  if (sc('rsc-cameras')) html += `
    <div class="rp-section"><h4>📷 الكاميرات / Camera Summary</h4>
      <table class="rp-table">
        <tr><th>الإجمالي</th><th>داخلية</th><th>خارجية</th><th>البراند</th><th>الدقة</th><th>نظام التسجيل</th></tr>
        <tr><td><b>${state.cameras.total}</b></td><td>${state.cameras.indoor}</td><td>${state.cameras.outdoor}</td>
            <td>${v('cameraBrand')}</td><td>${v('defaultResolution')}</td><td>${v('recordingSystem')}</td></tr>
      </table>
      <table class="rp-table" style="margin-top:6px">
        <tr><th>الطابق</th><th>داخلية</th><th>خارجية</th><th>الإجمالي</th><th>متوسط الكابل</th><th>مجموعة الرك</th></tr>
        ${floorData.map(f=>`<tr><td>${f.label}</td><td>${f.indoor}</td><td>${f.outdoor}</td><td>${f.indoor+f.outdoor}</td><td>${f.cableLen}م</td><td>${f.rackGroup}</td></tr>`).join('')}
        <tr style="font-weight:700"><td>الإجمالي</td><td>${state.cameras.indoor}</td><td>${state.cameras.outdoor}</td><td>${state.cameras.total}</td><td>–</td><td>${state.racks.length} ركات</td></tr>
      </table></div>`;

  if (sc('rsc-racks')) html += `
    <div class="rp-section"><h4>🗄️ الركات والـ UPS — EIA-310-D</h4>
      <table class="rp-table">
        <tr><th>عدد الركات</th><th>مواصفات الرك</th><th>UPS</th><th>التخزين (H.265)</th></tr>
        <tr><td>${state.racks.length}</td><td>${rackDims}</td><td>${upsInfo}</td>
            <td>${(state.cameras.total*0.75*(parseInt(v('archiveDays'))||30)/1000).toFixed(2)} TB</td></tr>
      </table></div>`;

  if (sc('rsc-cables')) html += `
    <div class="rp-section"><h4>🔌 الكابلات — TIA-568-C.2</h4>
      <table class="rp-table">
        <tr><th>IP Cable (${v('ipCableType')})</th><th>Analog (${v('analogCableType')})</th><th>الإجمالي</th><th>البراند</th><th>الهدر</th></tr>
        <tr><td>${state.cables.ipLength}م</td><td>${state.cables.analogLength}م</td>
            <td><b>${state.cables.totalLength}م</b></td><td>${v('cableBrand')}</td><td>${v('wasteFactor')}%</td></tr>
      </table></div>`;

  if (sc('rsc-fiber') && fb.totalCableLen) html += `
    <div class="rp-section"><h4>💡 الفايبر أوبتيك — TIA-568.3-D / ITU-T G.652</h4>
      <table class="rp-table">
        <tr><th>نوع الفايبر</th><th>الكورات</th><th>الطول الكلي</th><th>ODF</th><th>نقاط اللحام</th><th>Loss Budget</th></tr>
        <tr><td>${fb.fiberType||'–'}</td><td>${fb.coresNum||'–'}F</td><td>${fb.totalCableLen||0}م</td>
            <td>${fb.odfCount||0}</td><td>${fb.spliceCount||0}</td><td>${(fb.totalLoss||0).toFixed(2)} dB</td></tr>
      </table>
      ${(fb.runs||[]).map(r=>`<div style="font-size:11px;color:#666;margin-top:3px">• ${r.label}: ${r.len}م — ${r.type==='intra'?'داخل المبنى':'Inter-Building'}</div>`).join('')}
    </div>`;

  if (sc('rsc-network') && nw.poeSwitchCount) html += `
    <div class="rp-section"><h4>🌐 الشبكة — IEEE 802.3 / TIA-942</h4>
      <table class="rp-table">
        <tr><th>Core Switch</th><th>PoE Switches</th><th>NVR Count</th><th>Bandwidth</th><th>PoE Load</th><th>SFP</th></tr>
        <tr><td>${nw.coreBrand||'–'}</td><td>${nw.poeSwitchCount}</td><td>${nw.nvrCount||0}</td>
            <td>${nw.totalBW||0} Mbps</td><td>${(nw.totalPoeLoad||0).toFixed(0)}W</td><td>${nw.sfpQty||0}</td></tr>
      </table></div>`;

  if (sc('rsc-vw') && vw.totalScr) html += `
    <div class="rp-section"><h4>🖥️ Video Wall وغرفة المراقبة — ISO 11064 / AVIXA</h4>
      <table class="rp-table">
        <tr><th>Video Wall</th><th>Controller</th><th>الأبعاد</th><th>مساحة الغرفة</th><th>التبريد</th></tr>
        <tr><td>${vw.totalScr} × ${vw.sizeIn||55}" (${vw.cols||3}×${vw.rows||2})</td>
            <td>${v('vwControllerType')}</td>
            <td>${(vw.wallW||0).toFixed(2)}م × ${(vw.wallH||0).toFixed(2)}م</td>
            <td>${cr.totalRoomArea||0} م²</td><td>${(cr.acLoad||0).toFixed(1)} kW = ${cr.acTons||0} TR</td></tr>
      </table></div>`;

  if (sc('rsc-labor')) html += `
    <div class="rp-section"><h4>👷 العمالة وأيام العمل</h4>
      <table class="rp-table">
        <tr><th>إجمالي الساعات</th><th>أيام العمل</th><th>الفريق</th><th>ساعات/يوم</th><th>معامل الصعوبة</th></tr>
        <tr><td>${state.labor.totalHours}h</td><td><b>${state.labor.totalDays} يوم</b></td>
            <td>${v('teamSize')} أفراد</td><td>${v('workHoursPerDay')}h</td><td>×${v('difficultyLevel')}</td></tr>
      </table></div>`;

  html += `
    <div style="margin-top:18px;padding:10px 14px;background:#f0f4f8;border-radius:6px;border-right:4px solid #0a2540;font-size:10px;color:#666;line-height:1.8">
      <strong>معايير مُطبّقة:</strong>
      IEC 62676 · EIA-310-D · TIA-568-C.2 · TIA-568.3-D · ISO/IEC 11801 ·
      ITU-T G.652/G.657 · IEEE 802.3af/at/bt · ISO 11064 · AVIXA M301.01 ·
      IEC 62040-3 · EN 50132 · NFPA 72 · ASHRAE 55<br/>
      © 2025 Ejaf Technology | Powered by Siwar | جميع الأرقام تقديرية وتخضع للمراجعة الهندسية
    </div>`;

  document.getElementById('reportBody').innerHTML = html;
};

// ── Full PDF export with all sections ──
window.exportPDF = async function(lang) {
  generateReport();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const v   = id => document.getElementById(id)?.value || '–';
  const sc  = id => document.getElementById(id)?.checked !== false;
  const pName = v('projectName'), cName = v('clientName'), date = v('projectDate');
  const isAr = lang === 'ar';

  const fb = state.fiber     || {};
  const nw = state.network   || {};
  const vw = state.videowall || {};
  const cr = state.controlRoom || {};
  const floorData = getFloorData().filter(f => f.indoor + f.outdoor > 0);

  // ── Header ──
  doc.setFillColor(10, 37, 64); doc.rect(0, 0, 210, 34, 'F');
  doc.setTextColor(0, 198, 255); doc.setFontSize(20); doc.setFont('helvetica', 'bold');
  doc.text('EJAF Technology', 14, 13);
  doc.setFontSize(9); doc.setTextColor(150, 200, 220);
  doc.text('CCTV Project Planner v3.0  |  Powered by Siwar', 14, 20);
  doc.text('IEC 62676 · EIA-310-D · TIA-568.3-D · IEEE 802.3 · ISO 11064 · ITU-T G.652', 14, 26);
  doc.setTextColor(255, 255, 255); doc.setFontSize(9);
  doc.text(`${isAr ? 'المشروع' : 'Project'}: ${pName}  |  ${cName}`, 120, 14);
  doc.text(`${date}  |  No: ${v('projectNumber')}`, 120, 20);
  doc.text(`${isAr ? 'المهندس' : 'Engineer'}: ${v('engineerName')}`, 120, 26);

  const AT = (sy, head, body, foot) => {
    doc.autoTable({
      startY: sy, head, body, foot: foot || [], theme: 'striped',
      headStyles: { fillColor: [10,37,64], textColor: [0,198,255], fontSize: 7.5 },
      footStyles: { fillColor: [220,235,250], fontStyle: 'bold', fontSize: 7.5 },
      styles: { fontSize: 8 }, margin: { left: 14, right: 14 },
    });
    return doc.lastAutoTable.finalY + 5;
  };

  const addTitle = (y, txt) => {
    if (y > 260) { doc.addPage(); y = 15; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
    doc.setTextColor(10, 37, 64); doc.text(txt, 14, y);
    doc.setTextColor(0, 0, 0);
    return y + 3;
  };

  let y = 40;

  if (sc('rsc-project')) {
    y = addTitle(y, isAr ? 'معلومات المشروع' : 'Project Information');
    y = AT(y, [['Field','Value','Field','Value']], [
      ['Project Name', pName, 'Client', cName],
      ['Location', v('projectLocation'), 'Engineer', v('engineerName')],
      ['Project No.', v('projectNumber'), 'Date', date],
      ['Standard', v('projectStandard'), 'Building Type', v('buildingType')],
    ]);
  }

  if (sc('rsc-cameras')) {
    y = addTitle(y, isAr ? 'الكاميرات' : 'Camera Configuration');
    y = AT(y,
      [['Total','Indoor','Outdoor','Brand','Resolution','System']],
      [[state.cameras.total, state.cameras.indoor, state.cameras.outdoor, v('cameraBrand'), v('defaultResolution'), v('recordingSystem')]],
    );
    y = addTitle(y, isAr ? 'تفصيل الطوابق' : 'Floor Details');
    y = AT(y,
      [['Floor','Indoor','Outdoor','Total','Cable(m)','Rack Group']],
      floorData.map(f=>[f.label,f.indoor,f.outdoor,f.indoor+f.outdoor,f.cableLen,f.rackGroup]),
      [['TOTAL', state.cameras.indoor, state.cameras.outdoor, state.cameras.total,'–', state.racks.length+' racks']]
    );
  }

  if (sc('rsc-racks')) {
    y = addTitle(y, isAr ? 'الركات — EIA-310-D' : 'Rack Distribution — EIA-310-D');
    const rackSel = document.getElementById('rackType');
    const rOpt = rackSel?.options[rackSel?.selectedIndex];
    const rd = rOpt ? `${rOpt.dataset.u}U ${rOpt.dataset.h}×${rOpt.dataset.w}×${rOpt.dataset.d}mm` : '–';
    const upsSys = v('upsSystem');
    let upsI = 'No UPS';
    if (upsSys==='per-rack') upsI=`${v('upsBrand')} ${document.getElementById('upsCapacityPerRack')?.value||'–'}VA`;
    else if (upsSys==='central') upsI=`Central ${document.getElementById('upsCapacityCentral')?.value||'–'}KVA`;
    y = AT(y,
      [['Racks','Rack Spec','UPS','Storage (H.265)','1U =']],
      [[state.racks.length, rd, upsI, (state.cameras.total*0.75*(parseInt(v('archiveDays'))||30)/1000).toFixed(2)+' TB', '44.45mm']]
    );
  }

  if (sc('rsc-cables')) {
    y = addTitle(y, isAr ? 'الكابلات — TIA-568-C.2' : 'Cables — TIA-568-C.2');
    y = AT(y,
      [['IP Cable','Length','Analog Cable','Length','Total','Brand','Waste']],
      [[v('ipCableType'), state.cables.ipLength+'m', v('analogCableType'), state.cables.analogLength+'m', state.cables.totalLength+'m', v('cableBrand'), v('wasteFactor')+'%']]
    );
  }

  if (sc('rsc-fiber') && fb.totalCableLen) {
    y = addTitle(y, isAr ? 'الفايبر أوبتيك — TIA-568.3-D' : 'Fiber Optic — TIA-568.3-D');
    y = AT(y,
      [['Fiber Type','Cores','Total Length','ODF','Splice Points','Loss Budget','Connector']],
      [[fb.fiberType||'–', (fb.coresNum||0)+'F', (fb.totalCableLen||0)+'m', fb.odfCount||0, fb.spliceCount||0, (fb.totalLoss||0).toFixed(2)+' dB', fb.connector||'–']]
    );
    if ((fb.runs||[]).length > 0) {
      y = AT(y,
        [['Run','Type','Length (m)','Cores']],
        fb.runs.map(r=>[r.label, r.type==='intra'?'Intra-Building':'Inter-Building', r.len, (r.cores||0)+'F'])
      );
    }
  }

  if (sc('rsc-network') && nw.poeSwitchCount) {
    y = addTitle(y, isAr ? 'الشبكة — IEEE 802.3' : 'Network — IEEE 802.3');
    y = AT(y,
      [['Core Switch','PoE Switches','NVR Count','Bandwidth','PoE Load','SFP','VLAN']],
      [[nw.coreBrand||'–', nw.poeSwitchCount, nw.nvrCount||0, (nw.totalBW||0)+' Mbps', (nw.totalPoeLoad||0).toFixed(0)+'W', nw.sfpQty||0, nw.vlan==='yes'?'VLAN '+v('vlanId'):'None']]
    );
  }

  if (sc('rsc-vw') && vw.totalScr) {
    y = addTitle(y, isAr ? 'Video Wall وغرفة المراقبة — ISO 11064' : 'Video Wall & Control Room — ISO 11064');
    y = AT(y,
      [['Video Wall','Size','Dims','Controller','Room Area','Cooling','Dist.']],
      [[`${vw.totalScr} screens (${vw.cols||3}×${vw.rows||2})`, (vw.sizeIn||55)+'"', `${(vw.wallW||0).toFixed(2)}×${(vw.wallH||0).toFixed(2)}m`, v('vwControllerType'), (cr.totalRoomArea||0)+' m²', (cr.acTons||0)+' TR', (vw.viewDist||0)+'m']]
    );
  }

  if (sc('rsc-labor')) {
    y = addTitle(y, isAr ? 'العمالة وأيام العمل' : 'Labor & Timeline');
    y = AT(y,
      [['Total Hours','Workdays','Team Size','Hrs/Day','Difficulty','Fiber Labor']],
      [[state.labor.totalHours+'h', state.labor.totalDays+' days', v('teamSize')+' persons', v('workHoursPerDay')+'h', '×'+v('difficultyLevel'), (fb.fiberLaborHours||0).toFixed(0)+'h']]
    );
  }

  // ── Footer on all pages ──
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFillColor(10,37,64); doc.rect(0,285,210,12,'F');
    doc.setTextColor(100,160,200); doc.setFontSize(7);
    doc.text('© 2025 Ejaf Technology – CCTV Planner v3.0 | Powered by Siwar', 14, 292);
    doc.text(`Page ${i} / ${pageCount}`, 185, 292);
    doc.setTextColor(60,100,140);
    doc.text('IEC 62676 · EIA-310-D · TIA-568.3-D · ISO 11064 · IEEE 802.3', 72, 292);
  }

  doc.save(`EJAF-CCTV-v3-${pName}-${lang.toUpperCase()}-${date}.pdf`);
};

// ── Full Excel export — all sheets ──
window.exportExcel = function() {
  generateReport();
  const wb = XLSX.utils.book_new();
  const v  = id => document.getElementById(id)?.value || '–';
  const fb = state.fiber     || {};
  const nw = state.network   || {};
  const vw = state.videowall || {};
  const cr = state.controlRoom || {};
  const floorData = getFloorData();
  const rackSel = document.getElementById('rackType');
  const rOpt = rackSel?.options[rackSel?.selectedIndex] || {};

  // S1: Project Info
  const s1 = XLSX.utils.aoa_to_sheet([
    ['EJAF Technology – CCTV Project Planner v3.0','','',''],
    ['Powered by Siwar','IEC 62676 · EIA-310-D · TIA-568.3-D · ISO 11064 · IEEE 802.3','',''],
    [],
    ['Project Name', v('projectName'),'Client', v('clientName')],
    ['Location', v('projectLocation'),'Engineer', v('engineerName')],
    ['Project No.', v('projectNumber'),'Date', v('projectDate')],
    ['Building Type', v('buildingType'),'Standard', v('projectStandard')],
    ['Camera Brand', v('cameraBrand'),'Resolution', v('defaultResolution')],
    ['Recording System', v('recordingSystem'),'',''],
    [],
    ['SUMMARY','','',''],
    ['Total Cameras', state.cameras.total,'Indoor', state.cameras.indoor],
    ['Outdoor', state.cameras.outdoor,'NVR Count', Math.ceil(state.cameras.total/(parseInt(v('nvrChannels'))||16))],
    ['Total Cable (m)', state.cables.totalLength,'Fiber Cable (m)', fb.totalCableLen||0],
    ['Racks', state.racks.length,'Workdays', state.labor.totalDays],
    ['Video Wall Screens', vw.totalScr||0,'Control Room (m²)', cr.totalRoomArea||0],
  ]);
  s1['!cols'] = [{wch:22},{wch:28},{wch:22},{wch:28}];
  XLSX.utils.book_append_sheet(wb, s1, 'Project Info');

  // S2: Floor Details
  const s2 = XLSX.utils.aoa_to_sheet([
    ['Floor','Indoor','Outdoor','Total','Cable Avg(m)','Rack Group'],
    ...floorData.map(f=>[f.label,f.indoor,f.outdoor,f.indoor+f.outdoor,f.cableLen,f.rackGroup]),
    ['TOTAL',state.cameras.indoor,state.cameras.outdoor,state.cameras.total,'–',state.racks.length+' racks'],
  ]);
  s2['!cols'] = [{wch:10},{wch:10},{wch:10},{wch:8},{wch:14},{wch:18}];
  XLSX.utils.book_append_sheet(wb, s2, 'Floor Details');

  // S3: Racks & UPS
  const upsSys = v('upsSystem');
  let upsInfo = 'No UPS';
  if (upsSys==='per-rack') upsInfo=`${v('upsBrand')} – ${document.getElementById('upsCapacityPerRack')?.value||'–'}VA`;
  else if (upsSys==='central') upsInfo=`Central ${document.getElementById('upsCapacityCentral')?.value||'–'}KVA – ${v('upsRuntimeCentral')}min`;
  const nvrCh = parseInt(v('nvrChannels'))||16;
  const s3 = XLSX.utils.aoa_to_sheet([
    ['Rack#','Group','Floors','Indoor','Outdoor','Total','NVR','PoE Switch','Storage(TB)','UPS'],
    ...state.racks.map((r,i)=>{
      const c=r.indoor+r.outdoor;
      return [i+1,r.label,r.floors.join(', '),r.indoor,r.outdoor,c,Math.ceil(c/nvrCh),Math.ceil(c/24),(c*0.75*(parseInt(v('archiveDays'))||30)/1000).toFixed(2),upsInfo];
    }),
    [],
    ['Rack Spec (EIA-310-D)',`${rOpt.dataset?.u||'–'}U`,`H:${rOpt.dataset?.h||'–'}`,`W:${rOpt.dataset?.w||'–'}`,`D:${rOpt.dataset?.d||'–'}`,`Load:${rOpt.dataset?.load||'–'}kg`,'1U=44.45mm','19"=482.6mm','',''],
  ]);
  s3['!cols'] = [{wch:6},{wch:14},{wch:22},{wch:8},{wch:8},{wch:8},{wch:6},{wch:12},{wch:12},{wch:35}];
  XLSX.utils.book_append_sheet(wb, s3, 'Racks & UPS');

  // S4: Cables
  const wf=(100+(parseInt(v('wasteFactor'))||15))/100;
  const s4 = XLSX.utils.aoa_to_sheet([
    ['Floor','Indoor','Outdoor',`${v('ipCableType')}(m)`,`${v('analogCableType')}(m)`,'Total(m)'],
    ...floorData.filter(f=>f.indoor+f.outdoor>0).map(f=>{
      const ip=Math.round(f.indoor*f.cableLen*wf), an=Math.round(f.outdoor*f.cableLen*wf);
      return [f.label,f.indoor,f.outdoor,ip,an,ip+an];
    }),
    ['TOTAL',state.cameras.indoor,state.cameras.outdoor,state.cables.ipLength,state.cables.analogLength,state.cables.totalLength],
    [],['Brand',v('cableBrand'),'Power',v('powerCableType'),'Waste',v('wasteFactor')+'%'],
    ['Standard','TIA-568-C.2','Max Cat6/6A Run','100m','Fiber for >100m',''],
  ]);
  s4['!cols'] = [{wch:8},{wch:8},{wch:8},{wch:16},{wch:16},{wch:10}];
  XLSX.utils.book_append_sheet(wb, s4, 'Cables');

  // S5: Fiber Optic
  const s5 = XLSX.utils.aoa_to_sheet([
    ['FIBER OPTIC — TIA-568.3-D / ITU-T G.652','','','','',''],
    ['Fiber Type', fb.fiberType||'–','Cores', (fb.coresNum||0)+'F','Total Cable(m)', fb.totalCableLen||0],
    ['ODF Count', fb.odfCount||0,'Splice Points', fb.spliceCount||0,'Loss Budget(dB)', (fb.totalLoss||0).toFixed(2)],
    ['Patchcords', fb.patchcordQty||0,'Connector', fb.connector||'–','Fiber Labor(h)', (fb.fiberLaborHours||0).toFixed(0)],
    [],
    ['Run','Type','Length(m)','Cores','–','–'],
    ...(fb.runs||[]).map(r=>[r.label, r.type, r.len, (r.cores||0)+'F','','']),
    [],
    ['ODF Type', v('odfType'),'ODF Brand', v('odfBrand'),'Splice Type', v('spliceType')],
    ['OTDR Test', v('otdrTest'),'Splicer Brand', v('splicerBrand'),'',''],
  ]);
  s5['!cols'] = [{wch:30},{wch:18},{wch:14},{wch:10},{wch:20},{wch:14}];
  XLSX.utils.book_append_sheet(wb, s5, 'Fiber Optic');

  // S6: Network
  const s6 = XLSX.utils.aoa_to_sheet([
    ['NETWORK — IEEE 802.3 / TIA-942','','','',''],
    ['Core Switch Brand', nw.coreBrand||'–','Model', v('coreSwitchModel'),'SFP', v('sfpType')],
    ['PoE Switch Brand', nw.poeBrand||'–','Size', v('poeSwitchSize')+'p','Standard', v('poeStandard')],
    ['PoE Switches Count', nw.poeSwitchCount||0,'NVR Count', nw.nvrCount||0,'SFP Qty', nw.sfpQty||0],
    ['Total Bandwidth(Mbps)', nw.totalBW||0,'Uplink', nw.uplinkBW>=1000?(nw.uplinkBW/1000)+'Gbps':nw.totalBW+' Mbps','PoE Load(W)', (nw.totalPoeLoad||0).toFixed(0)],
    ['VLAN', nw.vlan==='yes'?'VLAN '+v('vlanId'):'None','Cam Bitrate(Mbps)', v('camBitrate'),'',''],
    [],['Standards','IEEE 802.3af/at/bt · 802.1Q · 802.1p · 802.1D','','',''],
  ]);
  s6['!cols'] = [{wch:22},{wch:20},{wch:18},{wch:18},{wch:18}];
  XLSX.utils.book_append_sheet(wb, s6, 'Network');

  // S7: Video Wall & Control Room
  const s7 = XLSX.utils.aoa_to_sheet([
    ['VIDEO WALL & CONTROL ROOM — ISO 11064 / AVIXA','','',''],
    ['Display Type', v('displayType'),'Brand', v('displayBrand')],
    ['Screen Size', (vw.sizeIn||55)+'"','Configuration', `${vw.cols||3}×${vw.rows||2}`],
    ['Total Screens', vw.totalScr||0,'Wall Dimensions', `${(vw.wallW||0).toFixed(2)}m × ${(vw.wallH||0).toFixed(2)}m`],
    ['Wall Area(m²)', vw.wallArea||0,'Viewing Distance(m)', vw.viewDist||0],
    ['Controller', v('vwControllerType'),'Matrix Switch', v('matrixSwitch')],
    [],
    ['CONTROL ROOM — ISO 11064','','',''],
    ['Operators', cr.operators||0,'Room Area(m²)', cr.totalRoomArea||0],
    ['Room Width(m)', cr.recRoomW||0,'Room Depth(m)', cr.recRoomD||0],
    ['Cooling Load(kW)', (cr.acLoad||0).toFixed(1),'Cooling(TR)', cr.acTons||0],
    ['Lighting', v('roomLighting'),'Raised Floor', v('raisedFloor')],
    ['Access Control', v('accessControl'),'Fire System', v('fireSuppression')],
    ['Security Level', 'Level '+v('securityLevel'),'Location', v('roomLocation')],
    [],['Standards','ISO 11064-3 · AVIXA M301.01 · EN 12464-1 · ASHRAE 55 · NFPA 72','',''],
  ]);
  s7['!cols'] = [{wch:22},{wch:28},{wch:22},{wch:28}];
  XLSX.utils.book_append_sheet(wb, s7, 'Video Wall & Control Room');

  // S8: Labor
  const diff=parseFloat(v('difficultyLevel'))||1.2;
  const team=parseInt(v('teamSize'))||4;
  const hpd=parseInt(v('workHoursPerDay'))||8;
  const s8 = XLSX.utils.aoa_to_sheet([
    ['Activity','Base','Rate','Difficulty','Hours'],
    ['Camera Install',state.cameras.total+' cams',v('rateInstallCam')+'h/cam','×'+diff, Math.round(state.cameras.total*parseFloat(v('rateInstallCam')||1.5)*diff)],
    ['Cable Pull',state.cables.totalLength+'m',v('rateCablePull')+'h/100m','×'+diff, Math.round((state.cables.totalLength/100)*parseFloat(v('rateCablePull')||2)*diff)],
    ['Rack Install',state.racks.length+' racks',v('rateRackInstall')+'h/rack','×'+diff, Math.round(state.racks.length*parseFloat(v('rateRackInstall')||4)*diff)],
    ['Config & Test',state.cameras.total+' cams',v('rateConfig')+'h/cam','–', Math.round(state.cameras.total*parseFloat(v('rateConfig')||0.5))],
    ['Fiber Work','–','–','–', Math.round(fb.fiberLaborHours||0)],
    ['Mobilization','–','–','–', 4],
    ['Commissioning','–','0.1h/cam','–', Math.max(4,Math.round(state.cameras.total*0.1))],
    ['TOTAL',`Team: ${team} × ${hpd}h/day`,'','',state.labor.totalHours],
    ['WORKDAYS','','','',state.labor.totalDays],
  ]);
  s8['!cols'] = [{wch:20},{wch:18},{wch:16},{wch:12},{wch:10}];
  XLSX.utils.book_append_sheet(wb, s8, 'Labor');

  XLSX.writeFile(wb, `EJAF-CCTV-v3-${v('projectName')}-${v('projectDate')}.xlsx`);
};
