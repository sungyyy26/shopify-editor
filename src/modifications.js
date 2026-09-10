const { shopifyGraphQL } = require("./shopify");
const {
  FIND_FILE_BY_TITLE,
  RECENT_IMAGE_FILES,
  PRODUCT_UPDATE,
  PRODUCT_CREATE_MEDIA,
  PRODUCT_REORDER_MEDIA,
  PRODUCT_DELETE_MEDIA,
} = require("./queries");

// 쇼피파이는 같은 이름의 파일을 여러 번 올리면 무작위 UUID를 파일명 뒤에 붙인다.
// 대체 텍스트가 없는 파일은 그 UUID를 뗀 "원래 파일명"을 제목처럼 사용할 수 있게 한다.
function baseFilename(url) {
  if (!url) return "";
  try {
    const last = new URL(url).pathname.split("/").pop() || "";
    const withoutExt = last.replace(/\.[a-zA-Z0-9]+$/, "");
    return withoutExt.replace(/_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "");
  } catch {
    return "";
  }
}

// 이미지 하나를 대표하는 "표시 이름": 대체 텍스트가 있으면 그것, 없으면 원래 파일명
function mediaDisplayName(m) {
  return (m.alt && m.alt.trim()) || baseFilename(m.url);
}

function mapFileNode(node) {
  const url = node.image ? node.image.url : node.url || null;
  return { id: node.id, alt: node.alt, url, displayName: (node.alt && node.alt.trim()) || baseFilename(url) };
}

// 쇼피파이 파일 검색은 파일명만 검색하므로(대체 텍스트는 검색 안 함), 최근 등록된
// 이미지들을 따로 가져와 대체 텍스트 기준으로도 매칭되도록 합친다.
async function searchFiles(query) {
  const [byFilename, recent] = await Promise.all([
    shopifyGraphQL(FIND_FILE_BY_TITLE, { query }),
    shopifyGraphQL(RECENT_IMAGE_FILES, {}),
  ]);
  const needle = query.trim().toLowerCase();
  const filenameMatches = byFilename.files.edges.map((e) => mapFileNode(e.node));
  const altMatches = recent.files.edges
    .map((e) => mapFileNode(e.node))
    .filter((f) => f.displayName && f.displayName.toLowerCase().includes(needle));

  const merged = filenameMatches.slice();
  for (const f of altMatches) {
    if (!merged.some((m) => m.id === f.id)) merged.push(f);
  }
  return merged;
}

// title(들) 중 하나라도 파일명/대체 텍스트로 매칭되는 파일을 찾아 그 URL을 반환
async function findFileUrlByTitles(titles, cache) {
  for (const title of titles) {
    let url = cache.get(title);
    if (url === undefined) {
      const files = await searchFiles(title);
      const exact = files.find((f) => f.displayName === title);
      const file = exact || files[0];
      url = file ? file.url : null;
      cache.set(title, url);
    }
    if (url) return url;
  }
  return null;
}

// 태그 값 배열을 추가/교체/삭제 방식에 따라 최종 태그 배열로 계산 (실제 API 호출 없는 순수 함수)
function planTags(product, tagsMod) {
  if (!tagsMod || !tagsMod.mode) return null;
  const current = product.tags;

  if (tagsMod.mode === "replace") {
    const oldValues = (tagsMod.value || "").split(",").map((t) => t.trim()).filter(Boolean);
    const newValues = (tagsMod.newValue || "").split(",").map((t) => t.trim()).filter(Boolean);
    if (!oldValues.length || !newValues.length) return null;

    // "전체"만 입력하면 태그 전체를 새 목록으로 완전히 교체 (예전 "교체" 동작과 동일)
    if (oldValues.length === 1 && oldValues[0] === "전체") {
      const newTags = newValues;
      const changed = newTags.length !== current.length || newTags.some((t) => !current.includes(t)) || current.some((t) => !newTags.includes(t));
      if (!changed) return { action: "skip", reason: "태그 전체 교체 (변경 없음)" };
      return { action: "apply", reason: `태그 전체 교체: ${newValues.join(", ")}`, newTags };
    }

    // 그 외에는 기존 태그(들)를 변경 태그(들)로 순서대로 1:1 교체 (없는 태그는 건너뜀)
    const newTags = current.slice();
    const applied = [];
    oldValues.forEach((oldVal, i) => {
      const newVal = newValues[i];
      const idx = newTags.indexOf(oldVal);
      if (idx !== -1 && newVal && newTags[idx] !== newVal) {
        newTags[idx] = newVal;
        applied.push(`${oldVal} → ${newVal}`);
      }
    });
    if (!applied.length) return { action: "skip", reason: `교체할 태그를 찾지 못함: "${oldValues.join(", ")}"` };
    return { action: "apply", reason: `태그 교체: ${applied.join(", ")}`, newTags };
  }

  if (!tagsMod.value || !tagsMod.value.trim()) return null;
  const values = tagsMod.value.split(",").map((t) => t.trim()).filter(Boolean);
  let newTags;
  let label;
  if (tagsMod.mode === "remove") {
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

// 실제로 새 미디어를 등록하고(필요하면) 지정 위치로 옮기고(필요하면) 기존 것을 지우는 공통 실행부.
// addTitles 중 처음으로 실제 파일과 매칭되는 제목을 사용해 등록한다. presetUrl이 주어지면
// (예: 방금 업로드해 아직 쇼피파이 파일 라이브러리에서 검색되지 않는 이미지) 검색 없이 그 URL을 그대로 쓴다.
function makeAddMediaExecutor({ addTitles, position, oldId, cache, presetUrl }) {
  return async (productId) => {
    const url = presetUrl || (await findFileUrlByTitles(addTitles, cache));
    if (!url) throw new Error(`미디어를 쇼피파이에서 찾지 못함: "${addTitles.join(", ")}"`);
    const created = await shopifyGraphQL(PRODUCT_CREATE_MEDIA, {
      productId,
      media: [{ originalSource: url, mediaContentType: "IMAGE", alt: addTitles[0] }],
    });
    if (created.productCreateMedia.mediaUserErrors.length)
      throw new Error(created.productCreateMedia.mediaUserErrors.map((e) => e.message).join(", "));
    const newMediaId = created.productCreateMedia.media[0].id;

    const reordered = await shopifyGraphQL(PRODUCT_REORDER_MEDIA, { id: productId, moves: [{ id: newMediaId, newPosition: String(position - 1) }] });
    if (reordered.productReorderMedia.mediaUserErrors.length)
      throw new Error(reordered.productReorderMedia.mediaUserErrors.map((e) => e.message).join(", "));

    if (oldId) await shopifyGraphQL(PRODUCT_DELETE_MEDIA, { mediaIds: [oldId], productId });
    return newMediaId;
  };
}

// 미디어 작업 하나가 "지금 이 순간의" media 배열([{id, alt, url}, ...])을 기준으로 무엇을 할지
// 계산한다. 실제 mutation은 절대 호출하지 않는 순수 계산 + 읽기 전용 파일 조회만 수행하며,
// 성공 시 simulate(현재 목록을 반영한 다음 목록 계산)와 execute(실제 mutation 실행,
// 새로 만들어진 미디어가 있으면 그 id를 반환) 콜백을 함께 반환한다.
async function deriveMediaOpPlan(media, op, cache) {
  if (!op || !op.mode) return null;
  const mode = op.mode;
  const infoList = (op.infoList || []).map((s) => s.trim()).filter(Boolean);
  const newInfo = (op.newInfo || "").trim();

  if (mode === "move") {
    const from = parseInt(op.order, 10);
    const to = parseInt(op.moveTo, 10);
    if (!from || !to) return { action: "error", reason: "이동 순서 값이 올바르지 않음" };
    if (!media[from - 1]) return { action: "skip", reason: `${from}번 위치에 이미지가 없음` };
    if (to < 1 || to > media.length) return { action: "skip", reason: `${to}번은 잘못된 위치 (전체 ${media.length}개)` };
    if (from === to) return { action: "skip", reason: `이미 ${to}번 위치 (변경 없음)` };
    return {
      action: "apply",
      reason: `이미지 순서 변경: ${from}번 → ${to}번`,
      simulate: (arr) => {
        const copy = arr.slice();
        const [item] = copy.splice(from - 1, 1);
        copy.splice(to - 1, 0, item);
        return copy;
      },
      execute: async (productId, arr) => {
        const item = arr[from - 1];
        const res = await shopifyGraphQL(PRODUCT_REORDER_MEDIA, { id: productId, moves: [{ id: item.id, newPosition: String(to - 1) }] });
        if (res.productReorderMedia.mediaUserErrors.length)
          throw new Error(res.productReorderMedia.mediaUserErrors.map((e) => e.message).join(", "));
      },
    };
  }

  if (mode === "delete") {
    let targetIndex = -1;
    if (op.order) {
      // 순서가 주어지면 "그 자리의 이미지가 실제로 일치하는지"까지 확인해
      // 엉뚱한 위치의 다른 이미지를 잘못 지우는 일을 막는다.
      const position = parseInt(op.order, 10);
      const atPosition = media[position - 1];
      if (!atPosition) return { action: "skip", reason: `${position}번 위치에 이미지가 없음` };
      if (infoList.length && !infoList.includes(mediaDisplayName(atPosition)))
        return { action: "skip", reason: `${position}번 위치의 이미지가 다름 (실제: "${mediaDisplayName(atPosition) || "제목 없음"}") - 안전을 위해 건너뜀` };
      targetIndex = position - 1;
    } else if (infoList.length) {
      targetIndex = media.findIndex((m) => infoList.includes(mediaDisplayName(m)));
      if (targetIndex === -1) return { action: "skip", reason: `삭제할 이미지를 찾지 못함: "${infoList.join(", ")}"` };
    } else {
      return { action: "error", reason: "삭제할 이미지를 지정해주세요 (정보 또는 순서)" };
    }
    return {
      action: "apply",
      reason: `이미지 삭제: ${op.order ? op.order + "번" : `"${infoList.join(", ")}"`}`,
      simulate: (arr) => {
        const copy = arr.slice();
        copy.splice(targetIndex, 1);
        return copy;
      },
      execute: async (productId, arr) => {
        const res = await shopifyGraphQL(PRODUCT_DELETE_MEDIA, { mediaIds: [arr[targetIndex].id], productId });
        if (res.productDeleteMedia.mediaUserErrors.length)
          throw new Error(res.productDeleteMedia.mediaUserErrors.map((e) => e.message).join(", "));
      },
    };
  }

  // 교체: "정보"는 항상 찾을 기존 이미지, "변경할 이미지"는 항상 새 이미지를 뜻한다.
  // 순서가 주어지면 그 위치의 이미지가 "정보"와 일치하는지 확인 후 교체(안전장치),
  // 순서가 없으면 위치와 무관하게 "정보"와 일치하는 이미지를 찾아 교체한다.
  if (mode === "overwrite") {
    if (!infoList.length) return { action: "error", reason: "교체할 이미지를 입력해주세요" };
    if (!newInfo) return { action: "error", reason: "변경할 이미지를 입력해주세요" };
    let idx;
    let positionLabel;
    if (op.order) {
      const position = parseInt(op.order, 10);
      const atPosition = media[position - 1];
      if (!atPosition) return { action: "skip", reason: `${position}번 위치에 이미지가 없음` };
      if (!infoList.includes(mediaDisplayName(atPosition)))
        return { action: "skip", reason: `${position}번 위치의 이미지가 다름 (실제: "${mediaDisplayName(atPosition) || "제목 없음"}") - 안전을 위해 건너뜀` };
      idx = position - 1;
      positionLabel = `${position}번`;
    } else {
      idx = media.findIndex((m) => infoList.includes(mediaDisplayName(m)));
      if (idx === -1) return { action: "skip", reason: `교체할 이미지를 찾지 못함: "${infoList.join(", ")}"` };
      positionLabel = `${idx + 1}번, 위치 무관하게 찾음`;
    }
    if (media.some((m) => mediaDisplayName(m) === newInfo))
      return { action: "skip", reason: `이미 등록된 이미지 (건너뜀): "${newInfo}"` };
    const newUrl = op.newUrl || (await findFileUrlByTitles([newInfo], cache));
    if (!newUrl) return { action: "error", reason: `미디어를 쇼피파이에서 찾지 못함: "${newInfo}"` };
    const position = idx + 1;
    return {
      action: "apply",
      reason: `이미지 교체: "${infoList.join(", ")}" → "${newInfo}" (${positionLabel})`,
      simulate: (arr) => {
        const copy = arr.slice();
        copy[idx] = { id: "__pending__", alt: newInfo, url: newUrl };
        return copy;
      },
      execute: makeAddMediaExecutor({ addTitles: [newInfo], position, oldId: media[idx].id, cache, presetUrl: op.newUrl }),
    };
  }

  // 추가: 이미 같은 이미지가 등록되어 있으면 위치와 무관하게 건너뜀. 순서를 비워두면 맨 끝에 추가.
  if (!infoList.length) return { action: "error", reason: "등록할 이미지를 입력해주세요" };
  if (media.some((m) => infoList.includes(mediaDisplayName(m))))
    return { action: "skip", reason: `이미 등록된 이미지 (건너뜀): "${infoList.join(", ")}"` };

  const url = op.url || (await findFileUrlByTitles(infoList, cache));
  if (!url) return { action: "error", reason: `미디어를 쇼피파이에서 찾지 못함: "${infoList.join(", ")}"` };

  const position = op.order ? Math.max(1, Math.min(media.length + 1, parseInt(op.order, 10) || media.length + 1)) : media.length + 1;
  return {
    action: "apply",
    reason: `이미지 삽입: "${infoList.join(", ")}" (${position}번${op.order ? "" : ", 맨 끝"})`,
    simulate: (arr) => {
      const copy = arr.slice();
      copy.splice(position - 1, 0, { id: "__pending__", alt: infoList[0], url });
      return copy;
    },
    execute: makeAddMediaExecutor({ addTitles: infoList, position, oldId: null, cache, presetUrl: op.url }),
  };
}

// 프론트엔드는 하나의 미디어 작업에 여러 (정보/순서[/변경할 이미지]) 쌍을 배치로 담아 보낼 수 있다
// ({ mode, items: [{info, order, newInfo}, ...] }). deriveMediaOpPlan은 항상 단일 항목 기준으로
// 계산하므로, 배치 작업을 병렬 배열 순서대로 여러 개의 단일 작업으로 펼쳐서 순차 실행한다.
function expandMediaOp(op) {
  if (!op || op.mode === "move") return [op];
  return (op.items || []).map((item) => ({
    mode: op.mode,
    infoList: item.info ? [item.info] : [],
    order: item.order || null,
    newInfo: item.newInfo || "",
    url: item.url || null,
    newUrl: item.newUrl || null,
  }));
}

// 여러 미디어 작업을 입력한 순서대로 미리 계산 (실제 mutation 없음). 각 작업은 이전
// 작업들이 이미 반영된 것으로 가정한 "그 시점의" 목록을 기준으로 판단한다.
// finalMedia는 모든 작업이 반영된 것으로 가정한 마지막 목록(AS-IS/TO-BE 미리보기 표시용)이다.
async function previewMediaOps(product, mediaOps, cache) {
  let media = product.media.slice();
  const results = [];
  for (const op of mediaOps.flatMap(expandMediaOp)) {
    const plan = await deriveMediaOpPlan(media, op, cache);
    if (!plan) continue;
    results.push({ action: plan.action, reason: plan.reason });
    if (plan.action === "apply") media = plan.simulate(media);
  }
  return { results, finalMedia: media };
}

// 여러 미디어 작업을 입력한 순서대로 실제 반영. 한 작업이 끝날 때마다 그 결과로
// 목록을 갱신해 다음 작업이 최신 상태를 기준으로 판단하도록 한다.
async function applyMediaOps(product, mediaOps, cache) {
  let media = product.media.slice();
  const results = [];
  for (const op of mediaOps.flatMap(expandMediaOp)) {
    const plan = await deriveMediaOpPlan(media, op, cache);
    if (!plan) continue;
    if (plan.action !== "apply") {
      results.push({ action: plan.action, reason: plan.reason });
      continue;
    }
    try {
      const newId = await plan.execute(product.id, media);
      media = plan.simulate(media);
      if (newId) {
        const idx = media.findIndex((m) => m.id === "__pending__");
        if (idx !== -1) media[idx] = { id: newId, alt: media[idx].alt, url: null };
      }
      results.push({ action: "apply", reason: plan.reason });
    } catch (err) {
      results.push({ action: "error", reason: err.message });
    }
  }
  return results;
}

function summarize(parts) {
  if (!parts.length) return { action: "skip", reason: "적용할 변경사항 없음" };
  const errors = parts.filter((p) => p.action === "error");
  if (errors.length) return { action: "error", reason: errors.map((p) => p.reason).join("; ") };
  const applied = parts.filter((p) => p.action === "apply");
  return { action: applied.length ? "apply" : "skip", reason: parts.map((p) => p.reason).join(" · ") };
}

// 상품 하나에 수정사항을 적용했을 때 어떤 일이 일어날지 계산 (파일 조회 등 읽기 전용 API는 호출하되
// 실제 변경(mutation)은 하지 않음) - 미리보기 화면 전용. detail은 "적용 예시" 화면에 실제
// AS-IS/TO-BE 값을 보여주기 위한 것으로, 계산 비용이 낮아 항상 함께 반환하되 호출부에서
// 필요한 예시 1~2건에 대해서만 골라 사용한다.
async function evaluateModifications(product, modifications, cache) {
  const parts = [];
  const detail = {};
  if (modifications.title && modifications.title.trim()) {
    parts.push({ action: "apply", reason: "제목 변경" });
    detail.title = { before: product.title, after: modifications.title };
  }
  if (modifications.description && modifications.description.trim()) {
    parts.push({ action: "apply", reason: "설명 변경" });
    detail.description = { after: modifications.description };
  }

  const tagsPlan = planTags(product, modifications.tags);
  if (tagsPlan) {
    parts.push(tagsPlan);
    if (tagsPlan.action === "apply") detail.tags = { before: product.tags, after: tagsPlan.newTags };
  }

  const mediaOps = modifications.mediaOps || [];
  if (mediaOps.length) {
    const { results, finalMedia } = await previewMediaOps(product, mediaOps, cache);
    parts.push(...results);
    if (results.some((r) => r.action === "apply")) {
      detail.media = {
        before: product.media.map((m) => ({ url: m.url, name: mediaDisplayName(m) })),
        after: finalMedia.map((m) => ({ url: m.url, name: mediaDisplayName(m) })),
      };
    }
  }

  return { summary: summarize(parts), detail };
}

// 실제로 상품에 반영 (productUpdate + 미디어 작업들을 순서대로 실행)
async function applyModifications(product, modifications, cache) {
  const parts = [];
  const input = { id: product.id };
  if (modifications.title && modifications.title.trim()) {
    input.title = modifications.title;
    parts.push({ action: "apply", reason: "제목 변경" });
  }
  if (modifications.description && modifications.description.trim()) {
    input.descriptionHtml = modifications.description;
    parts.push({ action: "apply", reason: "설명 변경" });
  }
  const tagsPlan = planTags(product, modifications.tags);
  if (tagsPlan) {
    parts.push(tagsPlan);
    if (tagsPlan.action === "apply") input.tags = tagsPlan.newTags;
  }

  try {
    if (Object.keys(input).length > 1) {
      const updated = await shopifyGraphQL(PRODUCT_UPDATE, { input });
      if (updated.productUpdate.userErrors.length)
        throw new Error(updated.productUpdate.userErrors.map((e) => e.message).join(", "));
    }
    const mediaOps = modifications.mediaOps || [];
    if (mediaOps.length) parts.push(...(await applyMediaOps(product, mediaOps, cache)));
    return summarize(parts);
  } catch (err) {
    return { action: "error", reason: err.message };
  }
}

module.exports = { evaluateModifications, applyModifications, searchFiles };
