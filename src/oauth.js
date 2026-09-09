const crypto = require("crypto");
const https = require("https");

function buildAuthorizeUrl({ shop, apiKey, scopes, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: apiKey,
    scope: scopes,
    redirect_uri: redirectUri,
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

// Shopify가 콜백에 붙여 보내는 hmac 파라미터로 요청 위변조 여부 확인
function verifyHmac(query, apiSecret) {
  const { hmac, signature, ...rest } = query;
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("&");
  const digest = crypto.createHmac("sha256", apiSecret).update(message).digest("hex");
  return hmac && crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
}

function exchangeCodeForToken({ shop, apiKey, apiSecret, code }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ client_id: apiKey, client_secret: apiSecret, code });
    const req = https.request(
      {
        hostname: shop,
        path: "/admin/oauth/access_token",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            const data = JSON.parse(raw);
            if (!data.access_token) return reject(new Error(raw));
            resolve(data.access_token);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

module.exports = { buildAuthorizeUrl, verifyHmac, exchangeCodeForToken };
