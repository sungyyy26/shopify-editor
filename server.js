const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { loadEnv, setEnvValue } = require("./src/env");
loadEnv();

const { buildAuthorizeUrl, verifyHmac, exchangeCodeForToken } = require("./src/oauth");
const { shopifyGraphQL } = require("./src/shopify");
const { buildProductSearchQuery, PRODUCT_SEARCH, PRODUCTS_BY_IDS } = require("./src/queries");
const { evaluateModifications, applyModifications, searchFiles } = require("./src/modifications");
const jobStore = require("./src/jobStore");
const presetStore = require("./src/presetStore");

const PUBLIC_DIR = path.join(__dirname, "public");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const MAX_PAGES = 20; // 안전장치: 최대 5000개 상품까지 조회

function mapProductNode(node) {
  return {
    id: node.id,
    title: node.title,
    handle: node.handle,
    status: node.status,
    tags: node.tags,
    template: node.templateSuffix || "",
    url: node.onlineStorePreviewUrl,
    thumbnail: node.featuredImage ? node.featuredImage.url : null,
    media: node.media.edges.map((m) => ({ id: m.node.id, alt: m.node.alt, url: m.node.image ? m.node.image.url : null })),
  };
}

async function searchProducts(conditions) {
  const { title, tags, template } = conditions || {};
  const hasCondition =
    (title && title.trim()) ||
    (conditions.handles || []).some((h) => h.trim()) ||
    (tags && tags.trim()) ||
    (template && template.trim()) ||
    (conditions.statuses || []).length;
  if (!hasCondition) throw new Error("조건을 최소 하나 이상 입력해주세요");

  const query = buildProductSearchQuery(conditions);
  let products = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await shopifyGraphQL(PRODUCT_SEARCH, { query, cursor });
    products = products.concat(data.products.edges.map((e) => mapProductNode(e.node)));
    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }

  // 제목/태그/템플릿은 부분 일치("포함")를 기대하므로 서버 쿼리 대신 여기서 필터링
  if (title && title.trim()) {
    const needle = title.trim().toLowerCase();
    products = products.filter((p) => p.title.toLowerCase().includes(needle));
  }
  if (tags && tags.trim()) {
    // 쉼표로 여러 태그를 입력하면 그 중 하나라도 포함하면 매칭 (OR)
    const needles = tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    products = products.filter((p) => {
      const productTags = p.tags.map((t) => t.toLowerCase());
      return needles.some((needle) => productTags.some((t) => t.includes(needle)));
    });
  }
  if (template && template.trim()) {
    const needle = template.trim().toLowerCase();
    products = products.filter((p) => p.template.toLowerCase().includes(needle));
  }
  return products;
}

async function fetchProductsByIds(ids) {
  const data = await shopifyGraphQL(PRODUCTS_BY_IDS, { ids });
  return data.nodes.filter(Boolean).map(mapProductNode);
}

function newJobId() {
  return crypto.randomUUID();
}

async function handleCreateJob(body) {
  const filter = body.filter || {};
  const candidates = await searchProducts(filter);
  const job = {
    id: newJobId(),
    createdAt: new Date().toISOString(),
    status: "후보조회됨",
    filter,
    candidates,
    edits: null,
    selectedProductIds: null,
    preview: null,
    result: null,
  };
  jobStore.create(job);
  return job;
}

async function handleUpdateJob(id, patch) {
  const job = jobStore.update(id, patch);
  if (!job) throw new Error("작업을 찾을 수 없습니다");
  return job;
}

async function handlePreviewJob(id) {
  const job = jobStore.get(id);
  if (!job) throw new Error("작업을 찾을 수 없습니다");
  const productIds = job.selectedProductIds || job.candidates.map((p) => p.id);
  const products = await fetchProductsByIds(productIds);
  const cache = new Map();
  const items = [];
  const examples = {};
  for (const product of products) {
    const { summary, detail } = await evaluateModifications(product, job.edits || {}, cache);
    items.push({ title: product.title, handle: product.handle, action: summary.action, reason: summary.reason });
    // "적용"/"건너뜀" 각각 처음 만나는 상품 하나씩만 실제 AS-IS/TO-BE 예시로 보관 (전체 항목에
    // detail을 붙이면 대량 조회 시 응답이 커지므로 예시 1~2건에 대해서만 유지)
    if (!examples[summary.action] && (summary.action === "apply" || summary.action === "skip")) {
      examples[summary.action] = { title: product.title, handle: product.handle, reason: summary.reason, detail };
    }
  }
  const preview = { items, examples, computedAt: new Date().toISOString() };
  return jobStore.update(id, { preview });
}

async function handleApplyJob(id) {
  const job = jobStore.get(id);
  if (!job) throw new Error("작업을 찾을 수 없습니다");
  const productIds = job.selectedProductIds || job.candidates.map((p) => p.id);
  if (!productIds.length) throw new Error("적용할 페이지가 없습니다");
  jobStore.update(id, { status: "처리중" });

  const products = await fetchProductsByIds(productIds);
  const cache = new Map();
  const items = [];
  for (const product of products) {
    const summary = await applyModifications(product, job.edits || {}, cache);
    items.push({
      title: product.title,
      handle: product.handle,
      action: summary.action,
      reason: summary.reason,
      url: product.url,
    });
  }
  const result = {
    matched: products.length,
    updated: items.filter((i) => i.action === "apply").length,
    errors: items.filter((i) => i.action === "error"),
    items,
  };
  const status = result.errors.length ? "오류" : "완료";
  return jobStore.update(id, { status, result });
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? "/index.html" : pathname;
  filePath = path.join(PUBLIC_DIR, path.normalize(filePath).replace(/^(\.\.[/\\])+/, ""));
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const SCOPES = "read_products,write_products,read_files";
const APP_URL = process.env.APP_URL || "http://localhost:3000";
const REDIRECT_URI = `${APP_URL}/auth/callback`;
let oauthState = null;

function startAuth(req, res) {
  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_API_KEY } = process.env;
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_API_KEY) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(".env에 SHOPIFY_STORE_DOMAIN / SHOPIFY_API_KEY를 먼저 설정하세요");
    return;
  }
  oauthState = crypto.randomBytes(16).toString("hex");
  const url = buildAuthorizeUrl({
    shop: SHOPIFY_STORE_DOMAIN,
    apiKey: SHOPIFY_API_KEY,
    scopes: SCOPES,
    redirectUri: REDIRECT_URI,
    state: oauthState,
  });
  res.writeHead(302, { Location: url });
  res.end();
}

async function handleAuthCallback(req, res, query) {
  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_API_KEY, SHOPIFY_API_SECRET } = process.env;
  if (query.state !== oauthState) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("잘못된 요청입니다 (state 불일치). 처음부터 다시 시도해주세요: /auth");
    return;
  }
  if (!verifyHmac(query, SHOPIFY_API_SECRET)) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("서명 검증 실패 (hmac). SHOPIFY_API_SECRET을 확인하세요");
    return;
  }
  try {
    const token = await exchangeCodeForToken({
      shop: SHOPIFY_STORE_DOMAIN,
      apiKey: SHOPIFY_API_KEY,
      apiSecret: SHOPIFY_API_SECRET,
      code: query.code,
    });
    setEnvValue("SHOPIFY_ADMIN_ACCESS_TOKEN", token);
    res.writeHead(302, { Location: "/" });
    res.end();
  } catch (err) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("토큰 발급 실패: " + err.message);
  }
}

const server = http.createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, "http://localhost");
  const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)(\/(preview|apply))?$/);
  const presetMatch = pathname.match(/^\/api\/presets\/([^/]+)$/);

  try {
    if (req.method === "GET" && pathname === "/auth") return startAuth(req, res);
    if (req.method === "GET" && pathname === "/auth/callback")
      return handleAuthCallback(req, res, Object.fromEntries(searchParams));
    if (req.method === "GET" && pathname === "/api/status")
      return sendJson(res, 200, { connected: Boolean(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) });

    if (req.method === "GET" && pathname === "/api/jobs") return sendJson(res, 200, { jobs: jobStore.list() });
    if (req.method === "POST" && pathname === "/api/jobs")
      return sendJson(res, 200, await handleCreateJob(await readJsonBody(req)));
    if (req.method === "DELETE" && pathname === "/api/jobs") {
      jobStore.removeAll();
      return sendJson(res, 200, { ok: true });
    }

    if (jobMatch) {
      const [, id, , action] = jobMatch;
      if (req.method === "PATCH" && !action) return sendJson(res, 200, await handleUpdateJob(id, await readJsonBody(req)));
      if (req.method === "DELETE" && !action) {
        jobStore.remove(id);
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === "POST" && action === "preview") return sendJson(res, 200, await handlePreviewJob(id));
      if (req.method === "POST" && action === "apply") return sendJson(res, 200, await handleApplyJob(id));
    }

    if (req.method === "GET" && pathname === "/api/media/search") {
      const q = (searchParams.get("q") || "").trim();
      const files = q ? await searchFiles(q) : [];
      return sendJson(res, 200, { files: files.slice(0, 8) });
    }

    if (req.method === "GET" && pathname === "/api/presets") return sendJson(res, 200, { presets: presetStore.list() });
    if (req.method === "POST" && pathname === "/api/presets") {
      const body = await readJsonBody(req);
      if (!body.name || !body.name.trim()) throw new Error("이름을 입력해주세요");
      const preset = { id: crypto.randomUUID(), name: body.name.trim(), filter: body.filter || {}, createdAt: new Date().toISOString() };
      presetStore.create(preset);
      return sendJson(res, 200, preset);
    }
    if (presetMatch && req.method === "DELETE") {
      presetStore.remove(presetMatch[1]);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET") return serveStatic(req, res, pathname);
    res.writeHead(404);
    res.end("Not found");
  } catch (err) {
    sendJson(res, 400, { error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Shopify Editor running on http://localhost:${PORT}`));
