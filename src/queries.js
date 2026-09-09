// 상태 체크박스 값 -> Shopify 검색 쿼리 절 매핑
const STATUS_CLAUSE = {
  active: "status:active",
  draft: "status:draft",
  unpublished: "published_status:unpublished",
};

// 제목/태그는 부분 일치("포함")를 기대하는데, Shopify의 tag: 필터는 완전 일치만 지원하고
// 특수문자(#, +, [, ] 등)는 검색 쿼리 문법과 충돌할 수 있어 둘 다 서버 쿼리에서 제외하고
// 서버에서 받아온 결과를 자바스크립트로 다시 필터링한다.
function buildProductSearchQuery({ statuses, handle }) {
  const clauses = [];
  if (handle && handle.trim()) clauses.push(`handle:${handle.trim()}`);
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
  onlineStorePreviewUrl
  media(first: 50) {
    edges { node { id alt } }
  }
`;

const PRODUCT_SEARCH = `
  query SearchProducts($query: String!, $cursor: String) {
    products(first: 250, query: $query, after: $cursor) {
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
  PRODUCT_CREATE_MEDIA,
  PRODUCT_REORDER_MEDIA,
  PRODUCT_DELETE_MEDIA,
};
