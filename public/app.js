/* ---------- connect check ---------- */
fetch("/api/status")
  .then((res) => res.json())
  .then((data) => {
    document.getElementById("connect-banner").hidden = data.connected;
    document.getElementById("app").hidden = !data.connected;
    if (data.connected) init();
  });

/* ---------- shared helpers ---------- */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtTime(iso) {
  try { return new Date(iso).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 2600);
}
const THUMB_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2h6M10 2v4.2c0 .5-.15.98-.44 1.38L6.9 11.4A3 3 0 0 0 6 13.5V20a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6.5a3 3 0 0 0-.9-2.1l-2.66-2.82A2.3 2.3 0 0 1 14 6.2V2"/></svg>';
function thumbTile() { return '<div class="thumb-tile">' + THUMB_SVG + "</div>"; }
const THUMB_FALLBACK = thumbTile();
function thumbFor(p) {
  if (!p.thumbnail) return thumbTile();
  return '<img class="thumb-img" src="' + esc(p.thumbnail) + '" alt="" loading="lazy" onerror="this.outerHTML=THUMB_FALLBACK">';
}
function statusLabelOf(code) { return { ACTIVE: "활성", DRAFT: "초안", ARCHIVED: "보관됨", UNLISTED: "미게시" }[code] || code; }
function statusClassOf(code) { return { ACTIVE: "r-active", DRAFT: "r-draft", ARCHIVED: "r-archived", UNLISTED: "r-archived" }[code] || ""; }

function paginate(items, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const p = Math.min(Math.max(1, page), totalPages);
  return { pageItems: items.slice((p - 1) * pageSize, p * pageSize), page: p, totalPages };
}
function renderPager(page, totalPages, groupClass) {
  if (totalPages <= 1) return "";
  let html = '<div class="pager ' + groupClass + '">';
  html += '<button data-page="' + (page - 1) + '" ' + (page <= 1 ? "disabled" : "") + ">‹</button>";
  for (let i = 1; i <= totalPages; i++) html += '<button data-page="' + i + '" class="' + (i === page ? "current" : "") + '">' + i + "</button>";
  html += '<button data-page="' + (page + 1) + '" ' + (page >= totalPages ? "disabled" : "") + ">›</button>";
  return html + "</div>";
}

function candidateCard(p, selectable, picked) {
  return '<div class="result-card' + (selectable ? " selectable" : "") + (picked ? " picked" : "") + '" data-id="' + esc(p.id) + '">'
    + (selectable ? '<input type="checkbox" class="result-check" ' + (picked ? "checked" : "") + ">" : "")
    + thumbFor(p)
    + '<div class="result-info">'
    + '<span class="r-badge ' + statusClassOf(p.status) + '">' + esc(statusLabelOf(p.status)) + "</span>"
    + '<span class="result-title">' + esc(p.title) + "</span>"
    + '<span class="result-handle">' + esc(p.handle) + "</span>"
    + (p.tags && p.tags.length ? '<span class="result-tags">' + esc(p.tags.join(", ")) + "</span>" : "")
    + "</div></div>";
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "요청 실패");
  return data;
}

/* ---------- Step 1: 조건 ---------- */
const ALL_STATUS = "all";
const statusChips = [...document.getElementById("statusChips").querySelectorAll(".chip")];
function setChip(chip, on) { chip.classList.toggle("on", on); chip.querySelector("input").checked = on; }
statusChips.forEach((chip) => {
  chip.addEventListener("click", (e) => {
    e.preventDefault();
    const willTurnOn = !chip.classList.contains("on");
    if (chip.dataset.val === ALL_STATUS) {
      statusChips.forEach((c) => setChip(c, c === chip ? willTurnOn : false));
    } else {
      setChip(chip, willTurnOn);
      if (willTurnOn) setChip(statusChips.find((c) => c.dataset.val === ALL_STATUS), false);
    }
    onFilterFormChange();
  });
});
function getStatuses() { return statusChips.filter((c) => c.classList.contains("on")).map((c) => c.dataset.val); }

const fEls = {
  "f-title": document.getElementById("f-title"),
  "f-tag": document.getElementById("f-tag"),
  "f-handle": document.getElementById("f-handle"),
  "f-template": document.getElementById("f-template"),
};
Object.values(fEls).forEach((el) => el.addEventListener("input", onFilterFormChange));
const filterSubmitBtn = document.getElementById("filterSubmitBtn");
const reqHint = document.getElementById("reqHint");
function hasAnyFilter() {
  return !!(fEls["f-title"].value.trim() || getStatuses().length || fEls["f-tag"].value.trim() || fEls["f-handle"].value.trim() || fEls["f-template"].value.trim());
}
function onFilterFormChange() {
  const has = hasAnyFilter();
  filterSubmitBtn.disabled = !has;
  reqHint.style.visibility = has ? "hidden" : "visible";
}
onFilterFormChange();
function extractHandle(raw) {
  const v = raw.trim();
  if (!v) return "";
  const parts = v.split("/").filter(Boolean);
  return parts[parts.length - 1];
}
// 줄바꿈 또는 쉼표로 여러 핸들/URL을 한 번에 입력할 수 있게 파싱
function extractHandles(raw) {
  const pieces = raw.split(/[\n,]/).map((s) => extractHandle(s)).filter(Boolean);
  return Array.from(new Set(pieces));
}
function buildFilterObj() {
  const filter = {};
  if (fEls["f-title"].value.trim()) filter.title = fEls["f-title"].value.trim();
  const statuses = getStatuses();
  if (statuses.length) filter.statuses = statuses;
  if (fEls["f-tag"].value.trim()) filter.tags = fEls["f-tag"].value.trim();
  const handles = extractHandles(fEls["f-handle"].value);
  if (handles.length) filter.handles = handles;
  if (fEls["f-template"].value.trim()) filter.template = fEls["f-template"].value.trim();
  return filter;
}

/* ---------- 즐겨찾기 (자주 쓰는 조건) ---------- */
let allPresets = [];
async function loadPresets() {
  try {
    const { presets } = await api("GET", "/api/presets");
    allPresets = presets;
    renderPresets();
  } catch (err) { /* 즐겨찾기 로드 실패는 조용히 무시 */ }
}
function renderPresets() {
  const el = document.getElementById("presetChips");
  if (!allPresets.length) { el.innerHTML = '<span class="panel-hint" style="margin:0;">저장된 조건이 없습니다.</span>'; return; }
  el.innerHTML = allPresets
    .map(
      (p) =>
        '<span class="chip preset-chip" data-id="' + esc(p.id) + '" style="cursor:default;display:inline-flex;align-items:center;gap:7px;">'
        + '<span class="preset-apply" style="cursor:pointer;">' + esc(p.name) + "</span>"
        + '<button type="button" class="preset-del" data-id="' + esc(p.id) + '" title="삭제" style="background:none;border:none;color:inherit;cursor:pointer;padding:0;font-size:12px;line-height:1;">✕</button>'
        + "</span>"
    )
    .join("");
  el.querySelectorAll(".preset-chip").forEach((chip) => {
    chip.querySelector(".preset-apply").addEventListener("click", () => {
      applyPreset(allPresets.find((p) => p.id === chip.dataset.id));
    });
  });
  el.querySelectorAll(".preset-del").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await api("DELETE", "/api/presets/" + btn.dataset.id);
        await loadPresets();
      } catch (err) { showToast("삭제 실패: " + err.message); }
    });
  });
}
function applyPreset(preset) {
  if (!preset) return;
  const f = preset.filter || {};
  fEls["f-title"].value = f.title || "";
  fEls["f-tag"].value = f.tags || "";
  fEls["f-handle"].value = (f.handles || []).join("\n");
  fEls["f-template"].value = f.template || "";
  statusChips.forEach((c) => setChip(c, (f.statuses || []).includes(c.dataset.val)));
  onFilterFormChange();
  showToast('즐겨찾기 "' + preset.name + '" 조건을 불러왔습니다.');
}
document.getElementById("savePresetBtn").addEventListener("click", async () => {
  if (!hasAnyFilter()) { showToast("저장할 조건을 먼저 입력하세요."); return; }
  const name = prompt("이 조건의 이름을 입력하세요:");
  if (!name || !name.trim()) return;
  try {
    await api("POST", "/api/presets", { name: name.trim(), filter: buildFilterObj() });
    showToast("즐겨찾기에 저장했습니다.");
    await loadPresets();
  } catch (err) { showToast("저장 실패: " + err.message); }
});

document.getElementById("filterForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (filterSubmitBtn.disabled) return;
  filterSubmitBtn.disabled = true;
  filterSubmitBtn.textContent = "검색 중...";
  try {
    const job = await api("POST", "/api/jobs", { filter: buildFilterObj() });
    currentJobId = job.id;
    currentJobData = job;
    step1Page = step2Page = step3Page = 1;
    step2Selected = new Set();
    step2InitedFor = null;
    setTabsEnabled(!!(job.candidates && job.candidates.length));
    renderStep1Results();
    renderStep2();
    renderStep3();
    await refreshJobs();
    showToast(job.candidates.length + "개 상품을 찾았습니다.");
  } catch (err) {
    showToast("검색 실패: " + err.message);
  } finally {
    filterSubmitBtn.textContent = "조건 검색";
    onFilterFormChange();
  }
});

/* ---------- Step tabs ---------- */
const tabBtns = [...document.querySelectorAll(".tab-btn")];
const stepContents = [...document.querySelectorAll(".step-content")];
let activeStep = 1;
function setStep(n) {
  activeStep = n;
  tabBtns.forEach((b) => b.classList.toggle("active", Number(b.dataset.step) === n));
  stepContents.forEach((el) => { el.hidden = Number(el.dataset.stepContent) !== n; });
}
tabBtns.forEach((b) => b.addEventListener("click", () => { if (!b.disabled) setStep(Number(b.dataset.step)); }));
function setTabsEnabled(enabled) { tabBtns[1].disabled = !enabled; tabBtns[2].disabled = !enabled; }

/* ---------- Active job state ---------- */
let currentJobId = null;
let currentJobData = null;
let step1Page = 1, step2Page = 1, step3Page = 1;
let step2Selected = new Set();
let step2InitedFor = null;

async function init() {
  loadPresets();
  try {
    const { jobs } = await api("GET", "/api/jobs");
    const active = jobs.find((j) => ["후보조회됨", "선택완료", "확인완료"].includes(j.status));
    if (active) {
      currentJobId = active.id;
      currentJobData = active;
      setTabsEnabled(!!(active.candidates && active.candidates.length));
      renderStep1Results();
      renderStep2();
      renderStep3();
    }
    renderJobs(jobs);
  } catch (err) {
    document.getElementById("jobList").innerHTML = '<p class="empty">작업 내역을 불러오지 못했습니다.</p>';
  }
}
async function refreshJobs() {
  const { jobs } = await api("GET", "/api/jobs");
  renderJobs(jobs);
}
async function refreshCurrentJob() {
  const { jobs } = await api("GET", "/api/jobs");
  currentJobData = jobs.find((j) => j.id === currentJobId) || currentJobData;
  renderJobs(jobs);
}

/* ---- Step 1 results (read-only, in place) ---- */
function renderStep1Results() {
  const el = document.getElementById("step1Results");
  const nextWrap = document.getElementById("step1NextWrap");
  if (!currentJobId) { el.innerHTML = ""; nextWrap.hidden = true; return; }
  const c = currentJobData.candidates || [];
  if (!c.length) {
    el.innerHTML = '<hr class="divider"><p class="empty">조건에 맞는 상품이 없습니다.</p>';
    nextWrap.hidden = true;
    return;
  }
  const { pageItems, page, totalPages } = paginate(c, step1Page, 12);
  el.innerHTML = '<hr class="divider">'
    + '<div class="results-head"><h3>조회 결과</h3><span class="count-badge">' + c.length + "건</span></div>"
    + '<div class="results-grid">' + pageItems.map((p) => candidateCard(p, false, false)).join("") + "</div>"
    + renderPager(page, totalPages, "step1-pager");
  el.querySelectorAll(".step1-pager button[data-page]").forEach((b) => {
    b.addEventListener("click", () => { step1Page = Number(b.dataset.page); renderStep1Results(); });
  });
  nextWrap.hidden = false;
}
document.getElementById("step1NextBtn").addEventListener("click", () => setStep(2));

/* ---- Step 2: 수정사항 입력 + 페이지 선택 ---- */
// 미디어는 한 번에 여러 작업(추가/교체/삭제/이동)을 순서대로 큐에 담아 적용할 수 있다.
// mediaOpDraft는 저장 전 편집 중인 행들의 상태(정보/순서/이동할 위치/방식)를 담는다.
let mediaOpDraft = [];
function newMediaOpRow() { return { info: "", order: "", moveTo: "", mode: null }; }

function mediaOpRowTpl(row, idx) {
  return '<div class="media-row" data-idx="' + idx + '">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;">'
    + '<span class="lbl">미디어 작업 ' + (idx + 1) + "</span>"
    + (mediaOpDraft.length > 1 ? '<button type="button" class="btn-secondary media-op-remove" data-idx="' + idx + '" style="padding:4px 12px;font-size:12px;">✕ 제거</button>' : "")
    + "</div>"
    + '<div class="media-grid">'
    + '<label class="field" style="position:relative;"><span class="lbl">정보 (등록된 이미지 제목/대체 텍스트로 검색)</span><input type="text" id="e-m-info-' + idx + '" placeholder="예: reseller_thumbnail" autocomplete="off"><div class="ac-list" id="e-m-info-ac-' + idx + '" hidden></div></label>'
    + '<label class="field"><span class="lbl">순서</span><input type="text" inputmode="numeric" id="e-m-order-' + idx + '" placeholder="예: 2"></label>'
    + '<label class="field"><span class="lbl">이동할 위치</span><input type="text" inputmode="numeric" id="e-m-moveto-' + idx + '" placeholder="예: 1" disabled></label>'
    + "</div>"
    + '<p class="panel-hint" style="margin:-4px 0 0;">정보는 이동 모드에서 사용하지 않습니다. 삭제 모드에서 순서를 비워두면 위치와 무관하게 정보와 일치하는 이미지를 찾습니다.</p>'
    + '<div class="field"><span class="lbl">방식</span><div class="modewrap" id="editModeWrap-' + idx + '">'
    + '<label class="mode-box" data-val="insert"><input type="checkbox">추가 — 지정 순서에 끼워 넣고 이후 밀기</label>'
    + '<label class="mode-box" data-val="overwrite"><input type="checkbox">교체 — 지정 순서 이미지만 바꾸기</label>'
    + '<label class="mode-box" data-val="delete"><input type="checkbox">삭제 — 지정 순서(또는 일치하는) 이미지 제거</label>'
    + '<label class="mode-box" data-val="move"><input type="checkbox">이동 — 새 이미지 없이 "순서" 위치를 "이동할 위치"로 옮기기</label>'
    + "</div></div></div>";
}

function renderMediaOpsContainer() {
  const el = document.getElementById("mediaOpsContainer");
  if (!el) return;
  el.innerHTML = mediaOpDraft.map((row, idx) => mediaOpRowTpl(row, idx)).join("")
    + '<button type="button" class="btn-secondary" id="addMediaOpBtn" style="align-self:flex-start;">+ 미디어 작업 추가</button>';
  wireMediaOpsContainer();
}

function syncMediaOpDraftFromDom() {
  mediaOpDraft.forEach((row, idx) => {
    const infoEl = document.getElementById("e-m-info-" + idx);
    const orderEl = document.getElementById("e-m-order-" + idx);
    const moveToEl = document.getElementById("e-m-moveto-" + idx);
    if (infoEl) row.info = infoEl.value;
    if (orderEl) row.order = orderEl.value;
    if (moveToEl) row.moveTo = moveToEl.value;
  });
}

function wireMediaOpsContainer() {
  mediaOpDraft.forEach((row, idx) => {
    const infoEl = document.getElementById("e-m-info-" + idx);
    const orderEl = document.getElementById("e-m-order-" + idx);
    const moveToEl = document.getElementById("e-m-moveto-" + idx);
    infoEl.value = row.info || "";
    orderEl.value = row.order || "";
    moveToEl.value = row.moveTo || "";
    wireMediaAutocomplete(infoEl, document.getElementById("e-m-info-ac-" + idx));

    const modeBoxes = [...document.getElementById("editModeWrap-" + idx).querySelectorAll(".mode-box")];
    modeBoxes.forEach((box) => {
      if (box.dataset.val === row.mode) { box.classList.add("on"); box.querySelector("input").checked = true; }
      box.addEventListener("click", (e) => {
        e.preventDefault();
        const turningOn = !box.classList.contains("on");
        modeBoxes.forEach((b) => { b.classList.remove("on"); b.querySelector("input").checked = false; });
        row.mode = turningOn ? box.dataset.val : null;
        if (turningOn) { box.classList.add("on"); box.querySelector("input").checked = true; }
        // "이동" 모드를 선택했을 때만 "이동할 위치" 입력을 활성화
        moveToEl.disabled = row.mode !== "move";
        if (moveToEl.disabled) moveToEl.value = "";
      });
    });
    moveToEl.disabled = row.mode !== "move";
  });

  el_qsa(".media-op-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncMediaOpDraftFromDom();
      mediaOpDraft.splice(Number(btn.dataset.idx), 1);
      renderMediaOpsContainer();
    });
  });
  document.getElementById("addMediaOpBtn").addEventListener("click", () => {
    syncMediaOpDraftFromDom();
    mediaOpDraft.push(newMediaOpRow());
    renderMediaOpsContainer();
  });
}
function el_qsa(sel) { return [...document.querySelectorAll(sel)]; }

const tagModeTpl = () =>
  '<div class="media-row"><span class="lbl">태그</span>'
  + '<label class="field"><span class="lbl">태그 값 (쉼표로 여러 개)</span><input type="text" id="e-t-value" placeholder="예: n-srm, sale"></label>'
  + '<div class="field"><span class="lbl">방식</span><div class="modewrap" id="editTagModeWrap">'
  + '<label class="mode-box" data-val="add"><input type="checkbox">추가 — 기존 태그에 더하기</label>'
  + '<label class="mode-box" data-val="replace"><input type="checkbox">교체 — 태그 전체를 이 값으로 바꾸기</label>'
  + '<label class="mode-box" data-val="remove"><input type="checkbox">삭제 — 이 태그만 제거</label>'
  + "</div></div></div>";

function renderStep2() {
  const el = document.getElementById("step2Panel");
  if (!currentJobId || !currentJobData.candidates) { el.innerHTML = '<p class="empty">Step 1에서 조건을 먼저 검색하세요.</p>'; return; }

  const editsSaved = !!currentJobData.edits;
  let html = '<div class="panel-head"><span class="panel-num">02</span><span class="panel-title">수정사항 · 페이지 선택</span></div>';

  if (!editsSaved) {
    mediaOpDraft = [newMediaOpRow()];
    html += '<p class="panel-hint">채울 항목만 적용됩니다. 미디어는 여러 작업을 순서대로 추가해 한 번에 적용할 수 있습니다 (각 작업은 이전 작업이 이미 반영된 상태를 기준으로 계산됩니다).</p>'
      + '<form id="editForm">'
      + '<label class="field"><span class="lbl">제목</span><input type="text" id="e-title" placeholder="새 제목"></label>'
      + '<label class="field"><span class="lbl">설명 (HTML)</span><textarea id="e-desc" class="code-input" placeholder="&lt;p&gt;설명 HTML&lt;/p&gt;"></textarea></label>'
      + '<div id="mediaOpsContainer"></div>'
      + tagModeTpl()
      + '<div class="actions"><span class="hint-req">수정사항을 1개 이상 입력하세요.</span>'
      + '<button type="submit" class="submit" id="editSubmitBtn">수정사항 저장</button></div>'
      + "</form>";
    el.innerHTML = html;
    renderMediaOpsContainer();
    wireEditForm();
    return;
  }

  const e = currentJobData.edits;
  const editRows = [
    ["제목", e.title || '<span class="tobe-nochange">(변경 없음)</span>'],
    ["설명", e.description ? esc(e.description.length) + "자 HTML" : '<span class="tobe-nochange">(변경 없음)</span>'],
    ["미디어", e.mediaOps && e.mediaOps.length ? esc(mediaOpsSummaryText(e.mediaOps)) : '<span class="tobe-nochange">(변경 없음)</span>'],
    ["태그", e.tags ? esc(e.tags.value) + " · " + esc(modeLabelTags(e.tags.mode)) : '<span class="tobe-nochange">(변경 없음)</span>'],
  ];
  html += '<div class="edit-summary">' + editRows.map((r) => '<div class="edit-summary-row"><dt>' + esc(r[0]) + "</dt><dd>" + r[1] + "</dd></div>").join("") + "</div>"
    + '<button type="button" class="btn-secondary" id="editAgainBtn" style="align-self:flex-start;">수정사항 다시 입력</button>'
    + '<hr class="divider">';

  const c = currentJobData.candidates;
  if (step2InitedFor !== currentJobId) { step2Selected = new Set(c.map((p) => p.id)); step2InitedFor = currentJobId; }
  const allPicked = c.every((p) => step2Selected.has(p.id));
  const { pageItems, page, totalPages } = paginate(c, step2Page, 12);

  html += '<div class="results-head"><h3>적용할 페이지 선택</h3>'
    + '<div style="display:flex;align-items:center;gap:10px;">'
    + '<span class="count-badge">' + step2Selected.size + " / " + c.length + "건 선택</span>"
    + '<button type="button" class="select-all" id="step2SelectAll">' + (allPicked ? "전체 해제" : "전체 선택") + "</button>"
    + "</div></div>"
    + '<div class="results-grid">' + pageItems.map((p) => candidateCard(p, true, step2Selected.has(p.id))).join("") + "</div>"
    + renderPager(page, totalPages, "step2-pager")
    + '<div class="actions">'
    + '<button type="button" class="btn-secondary" id="step2Back">이전</button>'
    + '<button type="button" class="submit" id="step2Confirm">선택 완료 · Step 3으로</button>'
    + "</div>";

  el.innerHTML = html;
  document.getElementById("editAgainBtn").addEventListener("click", async () => {
    currentJobData = await api("PATCH", "/api/jobs/" + currentJobId, { edits: null });
    renderStep2();
  });
  document.getElementById("step2SelectAll").addEventListener("click", () => {
    if (allPicked) step2Selected.clear(); else c.forEach((p) => step2Selected.add(p.id));
    renderStep2();
  });
  el.querySelectorAll(".result-card.selectable").forEach((card) => {
    card.addEventListener("click", () => {
      const id = card.dataset.id;
      step2Selected.has(id) ? step2Selected.delete(id) : step2Selected.add(id);
      renderStep2();
    });
  });
  el.querySelectorAll(".step2-pager button[data-page]").forEach((b) => {
    b.addEventListener("click", () => { step2Page = Number(b.dataset.page); renderStep2(); });
  });
  document.getElementById("step2Back").addEventListener("click", () => setStep(1));
  document.getElementById("step2Confirm").addEventListener("click", confirmStep2);
}

function modeLabelMedia(m) { return { insert: "추가", overwrite: "교체", delete: "삭제", move: "이동" }[m] || "-"; }
function mediaOpsSummaryText(ops) {
  return ops.map((op, i) => (i + 1) + ". " + mediaSummaryText(op)).join(" / ");
}
function mediaSummaryText(m) {
  if (m.mode === "move") return (m.order || "-") + "번 → " + (m.moveTo || "-") + "번 · 이동";
  return (m.info || "") + " · " + (m.order || "-") + "번 · " + modeLabelMedia(m.mode);
}
function modeLabelTags(m) { return { add: "추가", replace: "교체", remove: "삭제" }[m] || "-"; }

function wireModeWrap(wrapEl) {
  const modeBoxes = [...wrapEl.querySelectorAll(".mode-box")];
  modeBoxes.forEach((box) => {
    box.addEventListener("click", (e) => {
      e.preventDefault();
      const turningOn = !box.classList.contains("on");
      modeBoxes.forEach((b) => { b.classList.remove("on"); b.querySelector("input").checked = false; });
      if (turningOn) { box.classList.add("on"); box.querySelector("input").checked = true; }
    });
  });
  return () => { const on = modeBoxes.find((b) => b.classList.contains("on")); return on ? on.dataset.val : null; };
}

function wireMediaAutocomplete(input, listEl) {
  let debounceTimer;
  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (!q) { listEl.hidden = true; listEl.innerHTML = ""; return; }
    debounceTimer = setTimeout(async () => {
      try {
        const { files } = await api("GET", "/api/media/search?q=" + encodeURIComponent(q));
        if (!files.length) { listEl.hidden = true; listEl.innerHTML = ""; return; }
        listEl.innerHTML = files
          .map(
            (f) =>
              '<div class="ac-item" data-alt="' + esc(f.alt || "") + '">'
              + (f.url ? '<img src="' + esc(f.url) + '" class="ac-thumb">' : '<div class="ac-thumb"></div>')
              + "<span>" + esc(f.alt || "(제목 없음)") + "</span></div>"
          )
          .join("");
        listEl.hidden = false;
        listEl.querySelectorAll(".ac-item").forEach((item) => {
          item.addEventListener("mousedown", (e) => {
            e.preventDefault();
            input.value = item.dataset.alt;
            listEl.hidden = true;
            listEl.innerHTML = "";
          });
        });
      } catch (err) {
        listEl.hidden = true;
      }
    }, 300);
  });
  input.addEventListener("blur", () => { listEl.hidden = true; });
  input.addEventListener("focus", () => { if (listEl.innerHTML) listEl.hidden = false; });
}

function wireEditForm() {
  const getTagMode = wireModeWrap(document.getElementById("editTagModeWrap"));
  document.getElementById("editForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    syncMediaOpDraftFromDom();
    const edits = {};
    const title = document.getElementById("e-title").value.trim();
    const desc = document.getElementById("e-desc").value.trim();
    const tagValue = document.getElementById("e-t-value").value.trim();
    if (title) edits.title = title;
    if (desc) edits.description = desc;

    const mediaOps = [];
    for (const row of mediaOpDraft) {
      const info = (row.info || "").trim();
      const hasAnything = row.mode || info || row.order || row.moveTo;
      if (!hasAnything) continue; // 완전히 빈 행은 무시
      if (!row.mode) { showToast("미디어 작업의 방식(추가/교체/삭제/이동)을 선택하세요."); return; }
      if (row.mode === "move") {
        if (!row.order || !row.moveTo) { showToast("이동 모드에서는 순서와 이동할 위치를 모두 입력하세요."); return; }
        mediaOps.push({ order: row.order, moveTo: row.moveTo, mode: "move" });
      } else {
        if (!info) { showToast("미디어 작업에 정보(이미지 제목)를 입력하세요."); return; }
        mediaOps.push({ info, order: row.order || null, mode: row.mode });
      }
    }
    if (mediaOps.length) edits.mediaOps = mediaOps;

    if (tagValue) edits.tags = { value: tagValue, mode: getTagMode() };
    if (!Object.keys(edits).length) { showToast("수정사항을 1개 이상 입력하세요."); return; }
    if (edits.tags && !edits.tags.mode) { showToast("태그 방식(추가/교체/삭제)을 선택하세요."); return; }
    const btn = document.getElementById("editSubmitBtn");
    btn.disabled = true;
    try {
      currentJobData = await api("PATCH", "/api/jobs/" + currentJobId, { edits });
      renderStep2();
    } catch (err) {
      showToast("저장 실패: " + err.message);
      btn.disabled = false;
    }
  });
}

async function confirmStep2() {
  if (!step2Selected.size) { showToast("최소 1개 이상의 페이지를 선택하세요."); return; }
  try {
    currentJobData = await api("PATCH", "/api/jobs/" + currentJobId, { selectedProductIds: [...step2Selected], status: "선택완료", preview: null });
    await refreshJobs();
    setStep(3);
    renderStep3();
    runPreview();
  } catch (err) { showToast("선택 저장 실패: " + err.message); }
}

/* ---- Step 3: 최종 확인 ---- */
function renderStep3() {
  const el = document.getElementById("step3Panel");
  if (!currentJobId) { el.innerHTML = '<p class="empty">Step 1에서 조건을 먼저 검색하세요.</p>'; return; }
  const candidates = currentJobData.candidates || [];
  const picked = currentJobData.selectedProductIds || [...step2Selected];
  const selected = candidates.filter((p) => picked.includes(p.id));

  let html = '<div class="panel-head"><span class="panel-num">03</span><span class="panel-title">최종 확인</span></div>'
    + '<button type="button" class="disclosure" id="step3Disclosure" aria-expanded="false">적용 대상 ' + selected.length + '개 페이지 <span class="caret">▾</span></button>'
    + '<div class="disclosure-body" id="step3List" hidden>'
    + (selected.length ? '<div class="results-grid">' + selected.map((p) => candidateCard(p, false, false)).join("") + "</div>" : '<p class="empty">선택된 페이지가 없습니다.</p>')
    + "</div>"
    + renderTobe(currentJobData.edits || {}, currentJobData.preview)
    + '<div class="actions">'
    + '<button type="button" class="btn-secondary" id="step3Back">이전</button>'
    + '<button type="button" class="submit" id="step3Confirm">최종 확인 · 적용 실행</button>'
    + "</div>";

  el.innerHTML = html;
  document.getElementById("step3Disclosure").addEventListener("click", (e2) => {
    const btn = e2.currentTarget, body = document.getElementById("step3List");
    const open = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", String(!open));
    body.hidden = open;
  });
  document.getElementById("step3Back").addEventListener("click", () => setStep(2));
  document.getElementById("step3Confirm").addEventListener("click", confirmStep3);

  const table = document.getElementById("previewTableWrap");
  if (table) {
    const items = (currentJobData.preview && currentJobData.preview.items) || [];
    paginate(items, step3Page, 15);
    table.querySelectorAll(".step3-pager button[data-page]").forEach((b) => {
      b.addEventListener("click", () => { step3Page = Number(b.dataset.page); renderStep3(); });
    });
  }
}

async function runPreview() {
  if (!currentJobId) return;
  try {
    currentJobData = await api("POST", "/api/jobs/" + currentJobId + "/preview", {});
    renderStep3();
  } catch (err) { showToast("미리보기 계산 실패: " + err.message); }
}

function renderTobe(e, preview) {
  const rows = [
    ["제목", e.title ? esc(e.title) : '<span class="tobe-nochange">(변경 없음)</span>'],
    ["설명", e.description ? "새 설명 HTML 적용됨 (" + e.description.length + "자)" : '<span class="tobe-nochange">(변경 없음)</span>'],
    ["미디어", e.mediaOps && e.mediaOps.length ? esc(mediaOpsSummaryText(e.mediaOps)) : '<span class="tobe-nochange">(변경 없음)</span>'],
    ["태그", e.tags ? esc(e.tags.value) + " · " + esc(modeLabelTags(e.tags.mode)) : '<span class="tobe-nochange">(변경 없음)</span>'],
  ];
  let html = '<div class="tobe-block"><p class="tobe-head">적용 후 TO-BE</p>'
    + rows.map((r) => '<div class="tobe-row"><dt>' + esc(r[0]) + "</dt><dd>" + r[1] + "</dd></div>").join("");

  if (!preview || !preview.items) {
    html += '<p class="panel-hint" style="margin-top:10px;">미리보기를 계산하는 중입니다...</p></div>';
    return html;
  }

  const items = preview.items;
  const applyCount = items.filter((i) => i.action === "apply").length;
  const skipCount = items.filter((i) => i.action === "skip").length;
  const errCount = items.filter((i) => i.action === "error").length;
  html += '<div class="tobe-summary">'
    + '<div class="tobe-stat apply"><b>' + applyCount + "</b><span>적용</span></div>"
    + '<div class="tobe-stat skip"><b>' + skipCount + "</b><span>건너뜀</span></div>"
    + (errCount ? '<div class="tobe-stat"><b style="color:var(--error)">' + errCount + "</b><span>오류</span></div>" : "")
    + "</div>";

  const { pageItems, page, totalPages } = paginate(items, step3Page, 15);
  html += '<div id="previewTableWrap"><div class="item-table-wrap"><table class="item-table">'
    + "<thead><tr><th>제목</th><th>핸들</th><th>결과</th><th>사유</th></tr></thead><tbody>"
    + pageItems.map((it) => "<tr>"
        + '<td class="wrap-cell">' + esc(it.title || "") + "</td>"
        + "<td><code>" + esc(it.handle || "") + "</code></td>"
        + '<td><span class="item-status item-' + esc(it.action) + '">' + esc(actionLabel(it.action)) + "</span></td>"
        + '<td class="wrap-cell">' + esc(it.reason || "") + "</td>"
        + "</tr>").join("")
    + "</tbody></table></div>"
    + renderPager(page, totalPages, "step3-pager") + "</div>";

  return html + "</div>";
}
function actionLabel(a) { return { apply: "적용", skip: "건너뜀", error: "오류" }[a] || a; }

async function confirmStep3() {
  const btn = document.getElementById("step3Confirm");
  btn.disabled = true;
  btn.textContent = "적용 중...";
  try {
    currentJobData = await api("POST", "/api/jobs/" + currentJobId + "/apply", {});
    await refreshJobs();
    showToast("적용 완료: " + currentJobData.result.updated + "건 수정, " + currentJobData.result.errors.length + "건 오류");
    currentJobId = null;
    currentJobData = null;
    setTabsEnabled(false);
    setStep(1);
    document.getElementById("step1Results").innerHTML = "";
    document.getElementById("step1NextWrap").hidden = true;
  } catch (err) {
    showToast("적용 실패: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "최종 확인 · 적용 실행";
  }
}

/* ---------- Job history ---------- */
let allJobs = [];
let jobsPage = 1;

document.getElementById("clearJobsBtn").addEventListener("click", async () => {
  if (!allJobs.length) return;
  if (!confirm("작업 내역을 전체 삭제하시겠습니까? 되돌릴 수 없습니다.")) return;
  try {
    await api("DELETE", "/api/jobs");
    currentJobId = null;
    currentJobData = null;
    setTabsEnabled(false);
    setStep(1);
    document.getElementById("step1Results").innerHTML = "";
    document.getElementById("step1NextWrap").hidden = true;
    jobsPage = 1;
    showToast("작업 내역을 전체 삭제했습니다.");
    await refreshJobs();
  } catch (err) {
    showToast("삭제 실패: " + err.message);
  }
});

function jobSummaryLine(job) {
  const f = job.filter || {};
  const parts = [
    f.title ? "제목:" + f.title : null,
    f.statuses && f.statuses.length ? "상태:" + f.statuses.join(",") : null,
    f.tags ? "태그:" + f.tags : null,
    f.handles && f.handles.length ? "핸들:" + f.handles.join(",") : null,
    f.template ? "템플릿:" + f.template : null,
  ].filter(Boolean);
  return parts.join(" · ") || "조건 없음";
}

function renderJobs(jobs) {
  allJobs = jobs;
  const list = document.getElementById("jobList");
  document.getElementById("countBadge").textContent = allJobs.length + "건";
  if (!allJobs.length) { list.innerHTML = '<p class="empty">아직 검색한 작업이 없습니다.</p>'; return; }

  const { pageItems, page, totalPages } = paginate(allJobs, jobsPage, 6);
  jobsPage = page;

  list.innerHTML = pageItems.map((job) => {
    const f = job.filter || {};
    const e = job.edits || {};
    const filterRows = [
      f.title ? ["제목", f.title] : null,
      f.statuses && f.statuses.length ? ["상태", f.statuses.join(", ")] : null,
      f.tags ? ["태그", f.tags] : null,
      f.handles && f.handles.length ? ["핸들", f.handles.join(", ")] : null,
      f.template ? ["템플릿", f.template] : null,
      job.selectedProductIds && job.selectedProductIds.length ? ["선택", job.selectedProductIds.length + "개 상품"] : null,
    ].filter(Boolean);
    const editRows = [
      e.title ? ["제목", e.title] : null,
      e.description ? ["설명", e.description.length > 40 ? e.description.slice(0, 40) + "…" : e.description] : null,
      e.mediaOps && e.mediaOps.length ? ["미디어", mediaOpsSummaryText(e.mediaOps)] : null,
      e.tags ? ["태그", e.tags.value + (e.tags.mode ? " · " + modeLabelTags(e.tags.mode) : "")] : null,
    ].filter(Boolean);
    const status = job.status || "후보조회됨";
    const result = job.result;

    return '<div class="job" data-jobid="' + esc(job.id) + '">'
      + '<div class="job-top"><div class="job-top-left"><span class="job-time">' + esc(fmtTime(job.createdAt)) + "</span>"
      + '<span class="status-pill status-' + esc(status) + '">' + esc(status) + "</span></div>"
      + '<button type="button" class="job-del" title="삭제" data-jobid="' + esc(job.id) + '">✕</button></div>'
      + '<button type="button" class="disclosure job-disclosure" aria-expanded="false">'
      + '<span style="font-weight:400;color:var(--ink-dim);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(jobSummaryLine(job)) + "</span>"
      + '<span class="caret">▾</span>'
      + "</button>"
      + '<div class="disclosure-body" hidden>'
      + '<div class="job-body">'
      + '<div class="job-col"><p class="job-col-title">조건</p><dl>' + filterRows.map((r) => "<div><dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd></div>").join("") + "</dl></div>"
      + '<div class="job-col"><p class="job-col-title">수정사항</p><dl>' + (editRows.length ? editRows.map((r) => "<div><dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd></div>").join("") : "<div><dd>(미입력)</dd></div>") + "</dl></div>"
      + "</div>"
      + (result ? renderJobResult(result) : "")
      + "</div>"
      + "</div>";
  }).join("") + renderPager(page, totalPages, "jobs-pager");

  list.querySelectorAll(".job-del").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      try {
        await api("DELETE", "/api/jobs/" + btn.dataset.jobid);
        if (btn.dataset.jobid === currentJobId) {
          currentJobId = null; currentJobData = null; setTabsEnabled(false); setStep(1);
          document.getElementById("step1Results").innerHTML = "";
          document.getElementById("step1NextWrap").hidden = true;
        }
        showToast("작업을 삭제했습니다.");
        await refreshJobs();
      } catch (err) { showToast("삭제 실패: " + err.message); }
    });
  });
  list.querySelectorAll(".job-disclosure").forEach((btn) => {
    btn.addEventListener("click", () => {
      const body = btn.nextElementSibling;
      const open = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!open));
      body.hidden = open;
    });
  });
  list.querySelectorAll(".jobs-pager button[data-page]").forEach((b) => {
    b.addEventListener("click", () => { jobsPage = Number(b.dataset.page); renderJobs(allJobs); });
  });
}

function renderJobResult(result) {
  const summary = '<div class="result-line">일치 ' + (result.matched ?? "-") + "건 · 수정 " + (result.updated ?? "-") + "건"
    + (result.errors && result.errors.length ? " · 오류 " + result.errors.length + "건" : "") + "</div>";
  if (!result.items || !result.items.length) return summary;
  const rows = result.items.map((it) => "<tr>"
      + '<td class="wrap-cell">' + esc(it.title || "") + "</td>"
      + "<td><code>" + esc(it.handle || "") + "</code></td>"
      + '<td><span class="item-status item-' + esc(it.action) + '">' + esc(actionLabel(it.action)) + "</span></td>"
      + '<td class="wrap-cell">' + esc(it.reason || "") + "</td>"
      + "<td>" + (it.url ? '<a href="' + esc(it.url) + '" target="_blank" rel="noopener">바로가기</a>' : "") + "</td>"
      + "</tr>").join("");
  return summary + '<div class="result-table-wrap"><table class="result-table">'
    + "<thead><tr><th>제목</th><th>핸들</th><th>상태</th><th>비고</th><th>링크</th></tr></thead>"
    + "<tbody>" + rows + "</tbody></table></div>";
}
