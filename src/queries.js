// 상태 체크박스 값 -> Shopify 검색 쿼리 절 매핑
// "미게시"(목록 화면 배지)/"비공개"(상품 편집 화면 상태 드롭다운)로 표시되는 상태는
// status:archived가 아니라 실제로는 status:unlisted (실제 스토어 데이터로 확인됨).
const STATUS_CLAUSE = {
  active: "status:active",
  draft: "status:draft",
  archived: "status:unlisted",
};

// 제목/태그는 부분 일치("포함")를 기대하는데, Shopify의 tag: 필터는 완전 일치만 지원하고
// 특수문자(#, +, [, ] 등)는 검색 쿼리 문법과 충돌할 수 있어 둘 다 서버 쿼리에서 제외하고
// 서버에서 받아온 결과를 자바스크립트로 다시 필터링한다.
function buildProductSearchQuery({ statuses, handles }) {
  const clauses = [];
  const handleList = (handles || []).map((h) => h.trim()).filter(Boolean);
  if (handleList.length === 1) clauses.push(`handle:${handleList[0]}`);
  else if (handleList.length > 1) clauses.push("(" + handleList.map((h) => `handle:${h}`).join(" OR ") + ")");
  const activeStatuses = (statuses || []).filter(
    (s) => s && s !== "all" && STATUS_CLAUSE[s]
  );
  if (activeStatuses.length) {
    clauses.push("(" + activeStatuses.map((s) => STATUS_CLAUSE[s]).join(" OR ") + ")");
  }
  return clauses.join(" AND ");
}

const PRODUCT_FIELDS = `
  id
  title
  handle
  status
  tags
  templateSuffix
  onlineStorePreviewUrl
  featuredImage { url }
  media(first: 50) {
    edges { node { id alt ... on MediaImage { image { url } } } }
  }
`;

// 가장 최근에 수정한 페이지가 먼저 나오도록 정렬
const PRODUCT_SEARCH = `
  query SearchProducts($query: String!, $cursor: String) {
    products(first: 250, query: $query, after: $cursor, sortKey: UPDATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      edges { node { ${PRODUCT_FIELDS} } }
    }
  }
`;

const PRODUCTS_BY_IDS = `
  query ProductsByIds($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product { ${PRODUCT_FIELDS} }
    }
  }
`;

const PRODUCT_UPDATE = `
  mutation ProductUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id title }
      userErrors { field message }
    }
  }
`;

const FIND_FILE_BY_TITLE = `
  query FindFile($query: String!) {
    files(first: 10, query: $query) {
      edges {
        node {
          id
          alt
          ... on MediaImage { image { url } }
          ... on GenericFile { url }
        }
      }
    }
  }
`;

// 쇼피파이의 파일 검색(query)은 파일명만 검색하고 대체 텍스트(alt)는 검색하지 않는다
// (실제 스토어 데이터로 확인됨). alt로도 찾을 수 있도록 최근 등록된 이미지를 가져와
// 서버에서 alt 기준으로 직접 필터링하기 위한 쿼리.
const RECENT_IMAGE_FILES = `
  query RecentImageFiles {
    files(first: 50, sortKey: CREATED_AT, reverse: true, query: "media_type:IMAGE") {
      edges {
        node {
          id
          alt
          ... on MediaImage { image { url } }
        }
      }
    }
  }
`;

const PRODUCT_CREATE_MEDIA = `
  mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media { id }
      mediaUserErrors { field message }
    }
  }
`;

const PRODUCT_REORDER_MEDIA = `
  mutation ProductReorderMedia($id: ID!, $moves: [MoveInput!]!) {
    productReorderMedia(id: $id, moves: $moves) {
      mediaUserErrors { field message }
    }
  }
`;

const PRODUCT_DELETE_MEDIA = `
  mutation ProductDeleteMedia($mediaIds: [ID!]!, $productId: ID!) {
    productDeleteMedia(mediaIds: $mediaIds, productId: $productId) {
      deletedMediaIds
      mediaUserErrors { field message }
    }
  }
`;

module.exports = {
  buildProductSearchQuery,
  PRODUCT_SEARCH,
  PRODUCTS_BY_IDS,
  PRODUCT_UPDATE,
  FIND_FILE_BY_TITLE,
  RECENT_IMAGE_FILES,
  PRODUCT_CREATE_MEDIA,
  PRODUCT_REORDER_MEDIA,
  PRODUCT_DELETE_MEDIA,
};
