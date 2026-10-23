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
    // The maintenance guard checks settings before any user mutation.
    if (url.pathname === "/rest/v1/settings") return json([]);
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


test("maintenance status endpoint reports reason and reopening time", async () => {
  await withFetchStub(async url => {
    if (url.pathname === "/rest/v1/settings") return json([
      { key: "maintenanceEnabled", value: true },
      { key: "maintenanceReason", value: "Sedang perbaikan" },
      { key: "maintenanceReopenAt", value: "2099-01-01T00:00:00.000Z" },
    ]);
    return json({ message: "unexpected test request", path: url.pathname }, 500);
  }, async () => {
    const response = await worker.fetch(request("/api/maintenance"), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      enabled: true,
      reason: "Sedang perbaikan",
      reopenAt: "2099-01-01T00:00:00.000Z",
    });
  });
});

test("maintenance blocks user write requests before creating withdrawal requests", async () => {
  let rpcCalled = false;
  await withFetchStub(async url => {
    if (url.pathname === "/rest/v1/settings") return json([
      { key: "maintenanceEnabled", value: true },
      { key: "maintenanceReason", value: "Maintenance aktif" },
      { key: "maintenanceReopenAt", value: "" },
    ]);
    if (url.pathname.includes("/rpc/create_withdrawal")) rpcCalled = true;
    return json({ message: "unexpected test request", path: url.pathname }, 500);
  }, async () => {
    const response = await worker.fetch(request("/api/withdrawals", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "DANA", amount: 100, destination: "081234567890" }),
    }), env);
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /Maintenance aktif/);
    assert.equal(rpcCalled, false);
  });
});

test("DANA withdrawal calls the queue RPC with validated fields", async () => {
  let rpcBody;
  await withFetchStub(async (url, init) => {
    if (url.pathname === "/rest/v1/settings") return json([]);
    if (url.pathname === "/auth/v1/user") return json({ id: "44444444-4444-4444-8444-444444444444" });
    if (url.pathname === "/rest/v1/profiles") return json([{
      id: "44444444-4444-4444-8444-444444444444", username: "member_2", role: "user",
      balance: 1000, reserved_balance: 0, disabled: false,
    }]);
    if (url.pathname === "/rest/v1/rpc/create_withdrawal") {
      rpcBody = JSON.parse(init.body);
      return json({ id: 23, status: "pending", amount: 100, method: "DANA" });
    }
    return json({ message: "unexpected test request", path: url.pathname }, 500);
  }, async () => {
    const response = await worker.fetch(request("/api/withdrawals", {
      method: "POST", headers: { Authorization: "Bearer member-access-token", "content-type": "application/json" },
      body: JSON.stringify({ method: "DANA", amount: 100, destination: "081234567890" }),
    }), env);
    assert.equal(response.status, 201, await response.clone().text());
    assert.equal(rpcBody.p_user_id, "44444444-4444-4444-8444-444444444444");
    assert.equal(rpcBody.p_amount, 100);
    assert.equal(rpcBody.p_method, "DANA");
    assert.equal(rpcBody.p_destination, "081234567890");
    assert.equal((await response.json()).result.status, "pending");
  });
});

test("job creation includes the photo-required setting", async () => {
  let savedJob;
  await withFetchStub(async (url, init) => {
    if (url.pathname === "/auth/v1/user") return json({ id: "55555555-5555-4555-8555-555555555555" });
    if (url.pathname === "/rest/v1/profiles") return json([{
      id: "55555555-5555-4555-8555-555555555555", username: "admin_2", role: "admin",
      balance: 0, reserved_balance: 0, disabled: false,
    }]);
    if (url.pathname === "/rest/v1/jobs" && init.method === "POST") {
      savedJob = JSON.parse(init.body);
      return json([{ id: 81, ...savedJob }], 201);
    }
    if (url.pathname === "/rest/v1/audit_logs") return new Response(null, { status: 204 });
    return json({ message: "unexpected test request", path: url.pathname }, 500);
  }, async () => {
    const response = await worker.fetch(request("/api/admin/jobs", {
      method: "POST", headers: { Authorization: "Bearer admin-access-token", "content-type": "application/json" },
      body: JSON.stringify({ title: "Test task", description: "Desc", reward: 50, photo_required: true }),
    }), env);
    assert.equal(response.status, 201, await response.clone().text());
    assert.equal(savedJob.photo_required, true);
    assert.equal(savedJob.status, "active");
  });
});


test("Robux exchange creates a pending request through its dedicated RPC", async () => {
  let rpcBody;
  await withFetchStub(async (url, init) => {
    if (url.pathname === "/rest/v1/settings" && url.search.includes("key=in.")) return json([]);
    if (url.pathname === "/rest/v1/settings") return json([
      { key: "robuxMin", value: 10 },
      { key: "gamepassRate", value: 170 },
      { key: "usernameRate", value: 230 },
    ]);
    if (url.pathname === "/auth/v1/user") return json({ id: "66666666-6666-4666-8666-666666666666" });
    if (url.pathname === "/rest/v1/profiles") return json([{
      id: "66666666-6666-4666-8666-666666666666", username: "member_3", role: "user",
      balance: 1000, reserved_balance: 0, disabled: false,
    }]);
    if (url.pathname === "/rest/v1/rpc/create_robux_request") {
      rpcBody = JSON.parse(init.body);
      return json({ id: 24, status: "pending", method: "username", robux: 2, cost: 460 });
    }
    if (url.pathname === "/rest/v1/audit_logs") return new Response(null, { status: 204 });
    return json({ message: "unexpected test request", path: url.pathname }, 500);
  }, async () => {
    const response = await worker.fetch(request("/api/robux", {
      method: "POST", headers: { Authorization: "Bearer member-access-token", "content-type": "application/json" },
      body: JSON.stringify({ method: "username", robux: 2, username: "test_roblox" }),
    }), env);
    assert.equal(response.status, 201, await response.clone().text());
    assert.equal(rpcBody.p_user_id, "66666666-6666-4666-8666-666666666666");
    assert.equal(rpcBody.p_method, "username");
    assert.equal(rpcBody.p_robux, 2);
    assert.equal(rpcBody.p_username, "test_roblox");
    assert.equal(rpcBody.p_cost, 460);
    assert.equal((await response.json()).request.status, "pending");
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
    assert.ok(source.includes(rpc), `Worker route must reference ${rpc}`);
  }
  assert.match(sql, /submission-proofs[^;]*false/s, "proof bucket must not be public");
  assert.match(sql, /enable row level security/i);
});
