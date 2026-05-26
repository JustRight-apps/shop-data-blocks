import { jwtVerify } from "jose";

const CLOCK_TOLERANCE_SEC = 10;

function getKey(secret) {
  return new TextEncoder().encode(secret);
}

export async function verifyCustomerAccountRequest(request) {
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  if (!token) {
    throw new Response("Missing bearer token", { status: 401 });
  }

  const apiKey = process.env.SHOPIFY_API_KEY;
  const apiSecret = process.env.SHOPIFY_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Response("App not configured", { status: 500 });
  }

  let payload;
  try {
    const result = await jwtVerify(token, getKey(apiSecret), {
      algorithms: ["HS256"],
      clockTolerance: CLOCK_TOLERANCE_SEC,
    });
    payload = result.payload;
  } catch {
    throw new Response("Invalid token", { status: 401 });
  }

  if (payload.aud !== apiKey) {
    throw new Response("Audience mismatch", { status: 401 });
  }

  const shopDomain = parseShopDomain(payload.dest);
  const customerId = payload.sub ? String(payload.sub) : null;
  if (!shopDomain || !customerId) {
    throw new Response("Token missing shop or customer", { status: 401 });
  }

  return {
    shopDomain,
    customerId,
    customerGid: `gid://shopify/Customer/${customerId}`,
    payload,
  };
}

function parseShopDomain(dest) {
  if (!dest) return null;
  try {
    const url = new URL(dest);
    return url.host;
  } catch {
    return typeof dest === "string" ? dest.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : null;
  }
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

export function withCors(response) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    response.headers.set(k, v);
  }
  return response;
}

export function handleCorsPreflight(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return null;
}
