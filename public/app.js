const resultsEl = document.getElementById("results");
const applyBtn = document.getElementById("btn-apply");
let lastConditions = null;

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
  lastConditions = readConditions();
  resultsEl.textContent = "검색 중...";
  applyBtn.disabled = true;
  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conditions: lastConditions }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    renderProducts(data.products);
    applyBtn.disabled = data.products.length === 0;
  } catch (err) {
    resultsEl.textContent = "오류: " + err.message;
  }
});

document.getElementById("btn-apply").addEventListener("click", async () => {
  const modifications = readModifications();
  resultsEl.textContent = "적용 중...";
  try {
    const res = await fetch("/api/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conditions: lastConditions, modifications }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    renderResults(data.results);
  } catch (err) {
    resultsEl.textContent = "오류: " + err.message;
  }
});

function renderProducts(products) {
  if (!products.length) {
    resultsEl.textContent = "조건에 맞는 페이지가 없습니다.";
    return;
  }
  const rows = products
    .map((p) => `<tr><td>${p.title}</td><td>${p.handle}</td><td>${p.status}</td><td>${p.tags.join(", ")}</td></tr>`)
    .join("");
  resultsEl.innerHTML = `<p>${products.length}개 검색됨</p><table><tr><th>제목</th><th>핸들</th><th>상태</th><th>태그</th></tr>${rows}</table>`;
}

function renderResults(results) {
  const rows = results
    .map((r) => {
      const steps = r.steps
        .map((s) => `<span class="${s.ok ? "ok" : "fail"}">${s.message}</span>`)
        .join("<br/>") || "변경사항 없음";
      return `<tr><td>${r.title}</td><td>${steps}</td></tr>`;
    })
    .join("");
  resultsEl.innerHTML = `<table><tr><th>제목</th><th>결과</th></tr>${rows}</table>`;
}
