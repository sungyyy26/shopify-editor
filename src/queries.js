// 상태 체크박스 값 -> Shopify 검색 쿼리 절 매핑
const STATUS_CLAUSE = {
  active: "status:active",
  draft: "status:draft",
  unpublished: "published_status:unpublished",
};

function buildProductSearchQuery({ title, statuses, tags, handle }) {
  const clauses = [];
  if (title && title.trim()) clauses.push(`title:*${title.trim()}*`);
  if (handle && handle.trim()) clauses.push(`handle:${handle.trim()}`);
  if (tags && tags.trim()) {
    tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .forEach((t) => clauses.push(`tag:${t}`));
  }
  const activeStatuses = (statuses || []).filter(
    (s) => s && s !== "all" && STATUS_CLAUSE[s]
  );
  if (activeStatuses.length) {
    clauses.push("(" + activeStatuses.map((s) => STATUS_CLAUSE[s]).join(" OR ") + ")");
  }
  return clauses.join(" AND ");
}

const PRODUCT_SEARCH = `
  query SearchProducts($query: String!) {
    products(first: 250, query: $query) {
      edges {
        node {
          id
          title
          handle
          status
          tags
          media(first: 50) {
            edges { node { id } }
          }
        }
      }
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
  PRODUCT_UPDATE,
  FIND_FILE_BY_TITLE,
  PRODUCT_CREATE_MEDIA,
  PRODUCT_REORDER_MEDIA,
  PRODUCT_DELETE_MEDIA,
};
