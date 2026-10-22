/**
 * FunEarnEzz Cloudflare Worker API scaffold.
 *
 * Secrets (set with `wrangler secret put`):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Do not put the service-role key in frontend code or commit it.
 *
 * This first PR adds the Worker entry point without changing the existing
 * frontend files. Database/table/RPC integration is intentionally pending
 * the Supabase schema review and must be completed before production use.
 */
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request, env),
      });
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({
        ok: true,
        service: "funearnezz-api",
        databaseConfigured: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
      }, 200, corsHeaders(request, env));
    }

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS
        ? env.ASSETS.fetch(request)
        : new Response("Not found", { status: 404 });
    }

    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: "Backend is not configured" }, 503, corsHeaders(request, env));
    }

    // Fail closed until schema-backed handlers are added. This avoids
    // pretending auth, balances, admin actions, or withdrawals are functional.
    return json({
      error: "API endpoint not implemented yet",
      endpoint: url.pathname,
      message: "Complete the Supabase schema and server-side handlers before deployment.",
    }, 501, corsHeaders(request, env));
  },
};

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = env.FRONTEND_ORIGIN;
  const headers = { "Vary": "Origin" };
  if (origin && allowed && origin === allowed) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS";
  headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
  headers["Access-Control-Max-Age"] = "86400";
  return headers;
}
