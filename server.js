const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadEnv } = require("./src/env");
loadEnv();

const { shopifyGraphQL } = require("./src/shopify");
const {
  buildProductSearchQuery,
  PRODUCT_SEARCH,
  PRODUCT_UPDATE,
  FIND_FILE_BY_TITLE,
  PRODUCT_CREATE_MEDIA,
  PRODUCT_REORDER_MEDIA,
  PRODUCT_DELETE_MEDIA,
} = require("./src/queries");

const PUBLIC_DIR = path.join(__dirname, "public");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

async function searchProducts(conditions) {
  const query = buildProductSearchQuery(conditions);
  if (!query) throw new Error("조건을 최소 하나 이상 입력해주세요");
  const data = await shopifyGraphQL(PRODUCT_SEARCH, { query });
  return data.products.edges.map((e) => ({
    id: e.node.id,
    title: e.node.title,
    handle: e.node.handle,
    status: e.node.status,
    tags: e.node.tags,
    mediaIds: e.node.media.edges.map((m) => m.node.id),
  }));
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
  const url = await findFileUrlByTitle(media.info);
  if (!url) {
    return { ok: false, message: `미디어 "${media.info}"를 쇼피파이에서 찾지 못했습니다` };
  }

  const position = Math.max(1, parseInt(media.order, 10) || 1);
  let oldMediaIdAtPosition = null;
  if (media.mode === "overwrite") {
    oldMediaIdAtPosition = product.mediaIds[position - 1] || null;
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
  const { conditions, modifications } = body;
  const products = await searchProducts(conditions || {});
  const results = [];
  for (const product of products) {
    const entry = { id: product.id, title: product.title, steps: [] };

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

function serveStatic(req, res) {
  let filePath = req.url === "/" ? "/index.html" : req.url;
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

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && ROUTES[req.url]) {
    try {
      const body = await readJsonBody(req);
      const result = await ROUTES[req.url](body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  if (req.method === "GET") return serveStatic(req, res);
  res.writeHead(404);
  res.end("Not found");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Shopify Editor running on http://localhost:${PORT}`));
