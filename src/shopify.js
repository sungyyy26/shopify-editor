const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-10";

async function shopifyGraphQL(query, variables) {
  if (!DOMAIN || !TOKEN) {
    throw new Error(
      "SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_ACCESS_TOKEN이 설정되지 않았습니다 (.env 확인)"
    );
  }
  const res = await fetch(
    `https://${DOMAIN}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  const json = await res.json();
  if (json.errors) {
    throw new Error(JSON.stringify(json.errors));
  }
  return json.data;
}

module.exports = { shopifyGraphQL };
