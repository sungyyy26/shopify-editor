const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { loadEnv, setEnvValue } = require("./src/env");
loadEnv();

const { buildAuthorizeUrl, verifyHmac, exchangeCodeForToken } = require("./src/oauth");
const { shopifyGraphQL } = require("./src/shopify");
const {
  buildProductSearchQuery,
  PRODUCT_SEARCH,
  PRODUCTS_BY_IDS,
  PRODUCT_UPDATE,
  FIND_FILE_BY_TITLE,
  PRODUCT_CREATE_MEDIA,
  PRODUCT_REORDER_MEDIA,
  PRODUCT_DELETE_MEDIA,
} = require("./src/queries");

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
    url: node.onlineStorePreviewUrl,
    media: node.media.edges.map((m) => ({ id: m.node.id, alt: m.node.alt })),
  };
}

async function searchProducts(conditions) {
  const { title, tags } = conditions || {};
  const hasCondition =
    (title && title.trim()) ||
    (conditions.handle && conditions.handle.trim()) ||
    (tags && tags.trim()) ||
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

  // 제목/태그는 부분 일치를 기대하므로("포함") 서버 쿼리 대신 여기서 필터링
  if (title && title.trim()) {
    const needle = title.trim().toLowerCase();
    products = products.filter((p) => p.title.toLowerCase().includes(needle));
  }
  if (tags && tags.trim()) {
    const needles = tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    products = products.filter((p) => {
      const productTags = p.tags.map((t) => t.toLowerCase());
      return needles.every((needle) => productTags.some((t) => t.includes(needle)));
    });
  }
  return products;
}

async function fetchProductsByIds(ids) {
  const data = await shopifyGraphQL(PRODUCTS_BY_IDS, { ids });
  return data.nodes.filter(Boolean).map(mapProductNode);
}

async function findFileUrlByTitle(title) {
  const data = await shopifyGraphQL(FIND_FILE_BY_TITLE, { query: title });
  const nodes = data.files.edges.map((e) => e.node);
  const exact = nodes.find((n) => n.alt === title);
  const node = exact || nodes[0];
  if (!node) return null;
  return node.image ? node.image.url : node.url || null;
}

// 순서(1-based)를 삽입/덮어쓰기 정책에 따라 상품 미디어 목록에 반영
async function applyMedia(product, media) {
  // 이미 같은 이미지(제목/alt 일치)가 이 상품에 등록되어 있으면 위치와 무관하게 건너뜀
  if (product.media.some((m) => m.alt === media.info)) {
    return { ok: true, message: `이미 등록된 이미지입니다 (건너뜀): "${media.info}"` };
  }

  const url = await findFileUrlByTitle(media.info);
  if (!url) {
    return { ok: false, message: `미디어 "${media.info}"를 쇼피파이에서 찾지 못했습니다` };
  }

  const position = Math.max(1, parseInt(media.order, 10) || 1);
  let oldMediaIdAtPosition = null;
  if (media.mode === "overwrite") {
    oldMediaIdAtPosition = (product.media[position - 1] || {}).id || null;
  }

  const created = await shopifyGraphQL(PRODUCT_CREATE_MEDIA, {
    productId: product.id,
    media: [{ originalSource: url, mediaContentType: "IMAGE", alt: media.info }],
  });
  const createErrors = created.productCreateMedia.mediaUserErrors;
  if (createErrors.length) return { ok: false, message: createErrors.map((e) => e.message).join(", ") };
  const newMediaId = created.productCreateMedia.media[0].id;

  const reordered = await shopifyGraphQL(PRODUCT_REORDER_MEDIA, {
    id: product.id,
    moves: [{ id: newMediaId, newPosition: String(position - 1) }],
  });
  const reorderErrors = reordered.productReorderMedia.mediaUserErrors;
  if (reorderErrors.length) return { ok: false, message: reorderErrors.map((e) => e.message).join(", ") };

  if (oldMediaIdAtPosition) {
    await shopifyGraphQL(PRODUCT_DELETE_MEDIA, {
      mediaIds: [oldMediaIdAtPosition],
      productId: product.id,
    });
  }

  return { ok: true };
}

async function handleSearch(body) {
  const products = await searchProducts(body.conditions || {});
  return { products };
}

async function handleApply(body) {
  const { productIds, modifications } = body;
  if (!productIds || !productIds.length) throw new Error("적용할 페이지를 선택해주세요");
  const products = await fetchProductsByIds(productIds);
  const results = [];
  for (const product of products) {
    const entry = { id: product.id, title: product.title, url: product.url, steps: [] };

    const input = { id: product.id };
    if (modifications.title && modifications.title.trim()) input.title = modifications.title;
    if (modifications.description && modifications.description.trim())
      input.descriptionHtml = modifications.description;
    if (Object.keys(input).length > 1) {
      const updated = await shopifyGraphQL(PRODUCT_UPDATE, { input });
      const errs = updated.productUpdate.userErrors;
      entry.steps.push(
        errs.length
          ? { ok: false, message: errs.map((e) => e.message).join(", ") }
          : { ok: true, message: "제목/설명 수정 완료" }
      );
    }

    // 미디어 미설정 시(정보 미입력) 아무것도 적용하지 않음
    if (modifications.media && modifications.media.info && modifications.media.info.trim()) {
      const result = await applyMedia(product, modifications.media);
      entry.steps.push({ ...result, message: result.message || "미디어 수정 완료" });
    }

    results.push(entry);
  }
  return { results };
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

const ROUTES = { "/api/search": handleSearch, "/api/apply": handleApply };

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

  if (req.method === "GET" && pathname === "/auth") return startAuth(req, res);
  if (req.method === "GET" && pathname === "/auth/callback")
    return handleAuthCallback(req, res, Object.fromEntries(searchParams));
  if (req.method === "GET" && pathname === "/api/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ connected: Boolean(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) }));
    return;
  }

  if (req.method === "POST" && ROUTES[pathname]) {
    try {
      const body = await readJsonBody(req);
      const result = await ROUTES[pathname](body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  if (req.method === "GET") return serveStatic(req, res, pathname);
  res.writeHead(404);
  res.end("Not found");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Shopify Editor running on http://localhost:${PORT}`));
