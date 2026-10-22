import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import worker from "../worker.js";

const env = {
  SUPABASE_URL: "https://unit-test.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test_key",
};
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json" },
});
const request = (path, init = {}) => new Request("https://app.test" + path, init);
async function withFetchStub(stub, run) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => stub(new URL(typeof input === "string" ? input : input.url), init);
  try { await run(); } finally { globalThis.fetch = original; }
}

test("health reports missing service or publishable key instead of false-ready", async () => {
  const response = await worker.fetch(request("/api/health"), { SUPABASE_URL: env.SUPABASE_URL });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.databaseConfigured, false);
});

test("database-backed routes fail clearly when a required secret is missing", async () => {
  const response = await worker.fetch(request("/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "member_1", password: "Validpass123" }),
  }), { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: env.SUPABASE_PUBLISHABLE_KEY });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /belum dikonfigurasi/i);
});

test("registration rejects invalid usernames before calling Supabase", async () => {
  await withFetchStub(async () => { assert.fail("Supabase must not be called for invalid username"); }, async () => {
    const response = await worker.fetch(request("/api/auth/register", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "bad username", password: "Validpass123" }),
    }), env);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /username/i);
  });
});

test("invalid login is returned as 401 rather than a generic 500", async () => {
  await withFetchStub(async url => {
    assert.match(url.pathname, /\/auth\/v1\/token$/);
    return json({ msg: "Invalid login credentials" }, 400);
  }, async () => {
    const response = await worker.fetch(request("/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "member_1", password: "Wrongpass123" }),
    }), env);
    assert.equal(response.status, 401);
    assert.match((await response.json()).error, /Invalid login credentials/i);
  });
});

test("registration removes the Auth user if profile creation fails", async () => {
  const calls = [];
  await withFetchStub(async (url, init) => {
    calls.push({ path: url.pathname, method: init.method || "GET" });
    if (url.pathname === "/rest/v1/profiles" && (init.method || "GET") === "GET") return json([]);
    if (url.pathname === "/auth/v1/admin/users" && init.method === "POST") return json({ id: "11111111-1111-4111-8111-111111111111" });
    if (url.pathname === "/rest/v1/profiles" && init.method === "POST") return json({ message: "profile insert failed" }, 400);
    if (url.pathname === "/auth/v1/admin/users/11111111-1111-4111-8111-111111111111" && init.method === "DELETE") return new Response(null, { status: 204 });
    return json({ message: "unexpected test request" }, 500);
  }, async () => {
    const response = await worker.fetch(request("/api/register", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "member_1", password: "Validpass123" }),
    }), env);
    assert.equal(response.status, 400);
    assert.ok(calls.some(x => x.method === "DELETE" && x.path.endsWith("11111111-1111-4111-8111-111111111111")), "orphan Auth user should be deleted");
  });
});

test("multipart proof is validated, uploaded to private Storage, and its path is saved", async () => {
  let uploadedPath = "";
  let savedSubmission;
  await withFetchStub(async (url, init) => {
    if (url.pathname === "/auth/v1/user") return json({ id: "22222222-2222-4222-8222-222222222222" });
    if (url.pathname === "/rest/v1/profiles") return json([{
      id: "22222222-2222-4222-8222-222222222222", username: "member_1", role: "user",
      balance: 0, reserved_balance: 0, disabled: false,
    }]);
    if (url.pathname === "/rest/v1/jobs") return json([{ id: 7, reward: 50, status: "active" }]);
    if (url.pathname.startsWith("/storage/v1/object/submission-proofs/") && init.method === "POST") {
      uploadedPath = url.pathname;
      assert.equal(init.headers["Content-Type"], "image/png");
      return json({ Key: url.pathname });
    }
    if (url.pathname === "/rest/v1/submissions" && init.method === "POST") {
      savedSubmission = JSON.parse(init.body);
      return json([{ id: 9, ...savedSubmission }], 201);
    }
    return json({ message: "unexpected test request", path: url.pathname }, 500);
  }, async () => {
    const form = new FormData();
    form.append("note", "proof test");
    form.append("proof", new Blob(["test-image"], { type: "image/png" }), "proof.png");
    const response = await worker.fetch(request("/api/jobs/7/submit", {
      method: "POST", headers: { Authorization: "Bearer test-user-access-token" }, body: form,
    }), env);
    assert.equal(response.status, 201, await response.clone().text());
    assert.match(uploadedPath, /submission-proofs\/22222222-2222-4222-8222-222222222222\//);
    assert.equal(savedSubmission.status, "pending");
    assert.match(savedSubmission.proof_url, /^22222222-2222-4222-8222-222222222222\/[0-9a-f-]+\.png$/i);
  });
});

test("admin review delegates rewards and status transitions to transactional RPC", async () => {
  let rpcBody;
  await withFetchStub(async (url, init) => {
    if (url.pathname === "/auth/v1/user") return json({ id: "33333333-3333-4333-8333-333333333333" });
    if (url.pathname === "/rest/v1/profiles") return json([{
      id: "33333333-3333-4333-8333-333333333333", username: "admin_user", role: "admin",
      balance: 0, reserved_balance: 0, disabled: false,
    }]);
    if (url.pathname === "/rest/v1/rpc/review_submission") {
      rpcBody = JSON.parse(init.body);
      return json({ id: 12, status: "approved" });
    }
    if (url.pathname === "/rest/v1/audit_logs") return new Response(null, { status: 204 });
    return json({ message: "unexpected test request", path: url.pathname }, 500);
  }, async () => {
    const response = await worker.fetch(request("/api/admin/submissions/12/review", {
      method: "POST", headers: {
        Authorization: "Bearer admin-access-token", "content-type": "application/json",
      },
      body: JSON.stringify({ status: "approved", note: "valid" }),
    }), env);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(rpcBody.p_submission_id, "12");
    assert.equal(rpcBody.p_status, "approved");
    assert.equal(rpcBody.p_admin_id, "33333333-3333-4333-8333-333333333333");
  });
});

test("schema contract defines every RPC used by Worker and private proof storage", async () => {
  const sql = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  const source = await readFile(new URL("../worker.js", import.meta.url), "utf8");
  for (const rpc of ["create_withdrawal", "create_robux_request", "review_submission", "review_withdrawal", "review_robux_request", "admin_adjust_balance"]) {
    assert.match(sql, new RegExp("function public\\." + rpc + "\\s*\\("), `SQL function ${rpc} must exist`);
    assert.ok(source.includes("/rpc/" + rpc), `Worker route must call ${rpc}`);
  }
  assert.match(sql, /submission-proofs[^;]*false/s, "proof bucket must not be public");
  assert.match(sql, /enable row level security/i);
});
