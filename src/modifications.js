const { shopifyGraphQL } = require("./shopify");
const {
  FIND_FILE_BY_TITLE,
  PRODUCT_UPDATE,
  PRODUCT_CREATE_MEDIA,
  PRODUCT_REORDER_MEDIA,
  PRODUCT_DELETE_MEDIA,
} = require("./queries");

async function searchFiles(query) {
  const data = await shopifyGraphQL(FIND_FILE_BY_TITLE, { query });
  return data.files.edges.map((e) => {
    const n = e.node;
    return { id: n.id, alt: n.alt, url: n.image ? n.image.url : n.url || null };
  });
}

async function findFileUrlByTitle(title) {
  const files = await searchFiles(title);
  const exact = files.find((f) => f.alt === title);
  const file = exact || files[0];
  return file ? file.url : null;
}

// 태그 값 배열을 추가/교체/삭제 방식에 따라 최종 태그 배열로 계산 (실제 API 호출 없는 순수 함수)
function planTags(product, tagsMod) {
  if (!tagsMod || !tagsMod.value || !tagsMod.value.trim()) return null;
  const values = tagsMod.value.split(",").map((t) => t.trim()).filter(Boolean);
  const current = product.tags;
  let newTags;
  let label;
  if (tagsMod.mode === "replace") {
    newTags = values;
    label = "태그 교체";
  } else if (tagsMod.mode === "remove") {
    newTags = current.filter((t) => !values.includes(t));
    label = "태그 삭제";
  } else {
    newTags = Array.from(new Set([...current, ...values]));
    label = "태그 추가";
  }
  const changed = newTags.length !== current.length || newTags.some((t) => !current.includes(t));
  if (!changed) return { action: "skip", reason: `${label} (변경 없음)` };
  return { action: "apply", reason: `${label}: ${values.join(", ")}`, newTags };
}

// 미디어 정보(제목)가 이미 등록되어 있는지, 삭제 대상이 존재하는지 등을 판단하고
// 실제 반영이 필요할 때 실행할 run()을 함께 반환. cache는 같은 실행 안에서 동일한
// 미디어 제목을 여러 상품에 반복 조회하지 않도록 하는 findFileUrlByTitle 결과 캐시.
async function planMedia(product, media, cache) {
  if (!media || !media.info || !media.info.trim()) return null;
  const info = media.info.trim();
  const mode = media.mode;
  const existing = product.media.find((m) => m.alt === info);

  if (mode === "delete") {
    let target;
    if (media.order) {
      // 순서가 주어지면 "그 자리의 이미지 제목이 실제로 일치하는지"까지 확인해
      // 엉뚱한 위치의 다른 이미지를 잘못 지우는 일을 막는다.
      const position = parseInt(media.order, 10);
      const atPosition = product.media[position - 1];
      if (!atPosition) return { action: "skip", reason: `${position}번 위치에 이미지가 없음` };
      if (atPosition.alt !== info)
        return {
          action: "skip",
          reason: `${position}번 위치의 이미지 제목이 다름 (실제: "${atPosition.alt || "제목 없음"}") - 안전을 위해 건너뜀`,
        };
      target = atPosition;
    } else {
      target = existing;
      if (!target) return { action: "skip", reason: `삭제할 이미지를 찾지 못함: "${info}"` };
    }
    return {
      action: "apply",
      reason: `이미지 삭제: "${info}" (${media.order ? media.order + "번" : "위치 무관"})`,
      run: () => shopifyGraphQL(PRODUCT_DELETE_MEDIA, { mediaIds: [target.id], productId: product.id }),
    };
  }

  // 삽입/교체: 이미 같은 제목의 이미지가 등록되어 있으면 위치와 무관하게 건너뜀
  if (existing) return { action: "skip", reason: `이미 등록된 이미지 (건너뜀): "${info}"` };

  let url = cache.get(info);
  if (url === undefined) {
    url = await findFileUrlByTitle(info);
    cache.set(info, url);
  }
  if (!url) return { action: "error", reason: `미디어를 쇼피파이에서 찾지 못함: "${info}"` };

  const position = Math.max(1, parseInt(media.order, 10) || 1);
  return {
    action: "apply",
    reason: `이미지 ${mode === "insert" ? "삽입" : "교체"}: "${info}" (${position}번)`,
    run: async () => {
      const oldMediaIdAtPosition = mode === "overwrite" ? (product.media[position - 1] || {}).id || null : null;
      const created = await shopifyGraphQL(PRODUCT_CREATE_MEDIA, {
        productId: product.id,
        media: [{ originalSource: url, mediaContentType: "IMAGE", alt: info }],
      });
      if (created.productCreateMedia.mediaUserErrors.length)
        throw new Error(created.productCreateMedia.mediaUserErrors.map((e) => e.message).join(", "));
      const newMediaId = created.productCreateMedia.media[0].id;

      const reordered = await shopifyGraphQL(PRODUCT_REORDER_MEDIA, {
        id: product.id,
        moves: [{ id: newMediaId, newPosition: String(position - 1) }],
      });
      if (reordered.productReorderMedia.mediaUserErrors.length)
        throw new Error(reordered.productReorderMedia.mediaUserErrors.map((e) => e.message).join(", "));

      if (oldMediaIdAtPosition) {
        await shopifyGraphQL(PRODUCT_DELETE_MEDIA, { mediaIds: [oldMediaIdAtPosition], productId: product.id });
      }
    },
  };
}

function summarize(parts) {
  if (!parts.length) return { action: "skip", reason: "적용할 변경사항 없음" };
  const errors = parts.filter((p) => p.action === "error");
  if (errors.length) return { action: "error", reason: errors.map((p) => p.reason).join("; ") };
  const applied = parts.filter((p) => p.action === "apply");
  return { action: applied.length ? "apply" : "skip", reason: parts.map((p) => p.reason).join(" · ") };
}

// 상품 하나에 수정사항을 적용했을 때 어떤 일이 일어날지 계산 (파일 조회 등 읽기 전용 API는 호출하되
// 실제 변경(mutation)은 하지 않음) - 미리보기와 실제 적용 양쪽에서 공통으로 사용
async function evaluateModifications(product, modifications, cache) {
  const parts = [];
  if (modifications.title && modifications.title.trim()) parts.push({ action: "apply", reason: "제목 변경" });
  if (modifications.description && modifications.description.trim())
    parts.push({ action: "apply", reason: "설명 변경" });

  const tagsPlan = planTags(product, modifications.tags);
  if (tagsPlan) parts.push(tagsPlan);

  const mediaPlan = await planMedia(product, modifications.media, cache);
  if (mediaPlan) parts.push(mediaPlan);

  return { summary: summarize(parts), tagsPlan, mediaPlan };
}

// 실제로 상품에 반영 (productUpdate + 미디어 mutation 실행)
async function applyModifications(product, modifications, cache) {
  const { summary, tagsPlan, mediaPlan } = await evaluateModifications(product, modifications, cache);

  const input = { id: product.id };
  if (modifications.title && modifications.title.trim()) input.title = modifications.title;
  if (modifications.description && modifications.description.trim()) input.descriptionHtml = modifications.description;
  if (tagsPlan && tagsPlan.action === "apply") input.tags = tagsPlan.newTags;

  try {
    if (Object.keys(input).length > 1) {
      const updated = await shopifyGraphQL(PRODUCT_UPDATE, { input });
      if (updated.productUpdate.userErrors.length)
        throw new Error(updated.productUpdate.userErrors.map((e) => e.message).join(", "));
    }
    if (mediaPlan && mediaPlan.action === "apply") await mediaPlan.run();
    return summary;
  } catch (err) {
    return { action: "error", reason: err.message };
  }
}

module.exports = { evaluateModifications, applyModifications, searchFiles };
