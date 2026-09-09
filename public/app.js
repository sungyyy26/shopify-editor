fetch("/api/status")
  .then((res) => res.json())
  .then((data) => {
    document.getElementById("connect-banner").hidden = data.connected;
    document.getElementById("app").hidden = !data.connected;
  });

const resultsEl = document.getElementById("results");
const applyResultsEl = document.getElementById("apply-results");
const applyBtn = document.getElementById("btn-apply");
let lastProducts = [];

const statusSummary = document.getElementById("status-summary");
document.querySelectorAll('input[name="cond-status"]').forEach((el) => {
  el.addEventListener("change", () => {
    const checked = document.querySelectorAll('input[name="cond-status"]:checked');
    statusSummary.textContent = checked.length ? `상태 선택 (${checked.length})` : "상태 선택";
  });
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function readConditions() {
  const statuses = Array.from(
    document.querySelectorAll('input[name="cond-status"]:checked')
  ).map((el) => el.value);
  return {
    title: document.getElementById("cond-title").value,
    handle: document.getElementById("cond-handle").value,
    tags: document.getElementById("cond-tags").value,
    statuses,
  };
}

function readModifications() {
  const mode = document.querySelector('input[name="media-mode"]:checked');
  return {
    title: document.getElementById("mod-title").value,
    description: document.getElementById("mod-description").value,
    media: {
      info: document.getElementById("media-info").value,
      order: document.getElementById("media-order").value,
      mode: mode ? mode.value : null,
    },
  };
}

document.getElementById("btn-search").addEventListener("click", async () => {
  const conditions = readConditions();
  resultsEl.textContent = "검색 중...";
  applyBtn.disabled = true;
  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conditions }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    lastProducts = data.products;
    renderProducts(lastProducts);
    updateApplyButtonState();
  } catch (err) {
    resultsEl.textContent = "오류: " + err.message;
  }
});

document.getElementById("btn-apply").addEventListener("click", async () => {
  const productIds = Array.from(document.querySelectorAll(".pick:checked")).map((el) => el.value);
  if (!productIds.length) return;
  const modifications = readModifications();
  applyResultsEl.textContent = "적용 중...";
  try {
    const res = await fetch("/api/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productIds, modifications }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    renderResults(data.results);
  } catch (err) {
    applyResultsEl.textContent = "오류: " + err.message;
  }
});

function updateApplyButtonState() {
  const anyChecked = document.querySelectorAll(".pick:checked").length > 0;
  applyBtn.disabled = !anyChecked;
}

function renderProducts(products) {
  if (!products.length) {
    resultsEl.textContent = "조건에 맞는 페이지가 없습니다.";
    return;
  }
  const rows = products
    .map(
      (p) =>
        `<tr><td><input type="checkbox" class="pick" value="${p.id}" checked /></td><td>${escapeHtml(p.title)}</td><td>${escapeHtml(p.handle)}</td><td>${p.status}</td><td>${escapeHtml(p.tags.join(", "))}</td></tr>`
    )
    .join("");
  resultsEl.innerHTML = `
    <p>${products.length}개 검색됨</p>
    <table>
      <tr><th><input type="checkbox" id="pick-all" checked /></th><th>제목</th><th>핸들</th><th>상태</th><th>태그</th></tr>
      ${rows}
    </table>`;
  document.getElementById("pick-all").addEventListener("change", (e) => {
    document.querySelectorAll(".pick").forEach((cb) => (cb.checked = e.target.checked));
    updateApplyButtonState();
  });
  document.querySelectorAll(".pick").forEach((cb) => cb.addEventListener("change", updateApplyButtonState));
}

function renderResults(results) {
  const rows = results
    .map((r) => {
      const steps = r.steps
        .map((s) => `<span class="${s.ok ? "ok" : "fail"}">${s.message}</span>`)
        .join("<br/>") || "변경사항 없음";
      const link = r.url ? `<a href="${r.url}" target="_blank" rel="noopener">보기</a>` : "-";
      return `<tr><td>${escapeHtml(r.title)}</td><td>${steps}</td><td>${link}</td></tr>`;
    })
    .join("");
  applyResultsEl.innerHTML = `<table><tr><th>제목</th><th>결과</th><th>링크</th></tr>${rows}</table>`;
}
