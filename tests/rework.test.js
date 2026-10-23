import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL("../" + path, import.meta.url), "utf8");

test("initial route is a full-screen registration/login screen without branded landing content", async () => {
  const html = await read("index.html");
  assert.match(html, /id="authScreen"/);
  assert.match(html, /id="registerForm" class="form-stack"/);
  assert.match(html, /id="loginForm" class="form-stack hidden"/);
  assert.match(html, /name="username"/);
  assert.doesNotMatch(html, /id="hero"|class="brand"|FunEarnEzz|YukSetorWA/i);
  assert.match(html, /name="confirm"/);
  assert.doesNotMatch(html, /name="email"|name="referral"/i);
});

test("the dashboard uses a hamburger drawer and separates user and admin views", async () => {
  const html = await read("index.html");
  for (const view of ["dashboard", "history", "withdraw", "chat", "maintenance", "requests", "codes", "create-job", "review-jobs", "payout-settings"]) {
    assert.match(html, new RegExp('data-view="' + view + '"'));
  }
  assert.match(html, /id="menuButton"/);
  assert.match(html, /id="adminNav" class="drawer-group hidden"/);
});

test("frontend includes clear dialogs and the required user workflows", async () => {
  const app = await read("app.js");
  for (const route of ["/api/codes/redeem", "/api/chat", "/api/admin/codes", "/api/admin/jobs", "/api/admin/settings", "/api/admin/withdrawals", "/api/admin/robux"]) {
    assert.ok(app.includes(route), "missing frontend route " + route);
  }
  for (const text of ["Request kamu sedang diproses berdasarkan antrean. Mohon menunggu.", "Alasan penolakan wajib diisi", "WITHDRAW DITERIMA", "Aktifkan notifikasi", "DANA", "Game Pass"]) {
    assert.ok(app.includes(text), "missing expected UX behavior: " + text);
  }
  assert.doesNotMatch(app, /form\.method\.value/);
});

test("worker has authenticated chat moderation, code redemption and combined queue support routes", async () => {
  const worker = await read("worker.js");
  for (const phrase of [
    'path==="/api/chat"&&method==="GET"',
    'path==="/api/chat"&&method==="POST"',
    'path==="/api/admin/codes"&&method==="POST"',
    'path==="/api/codes/redeem"&&method==="POST"',
    "requireStaff(request,env)",
    "Alasan penolakan wajib diisi.",
    'path==="/api/withdrawals"&&method==="GET"',
    "announcementUpdatedAt",
    "Promosi, tautan undangan, dan iklan tidak diperbolehkan di Global Chat."
  ]) assert.ok(worker.includes(phrase), "missing API contract " + phrase);
});

test("the additive SQL protects code claims and reserves job quota in a transaction", async () => {
  const sql = await read("supabase/migrations/202610230003_pr21_product_rework.sql");
  for (const phrase of [
    "create table if not exists public.unique_codes",
    "unique_code_redemptions_code_user_uq",
    "public.redeem_unique_code",
    "for update",
    "public.funearnezz_reserve_job_quota",
    "public.funearnezz_release_rejected_job_quota",
    "payout_amount",
    "fee_amount",
    "public.create_withdrawal"
  ]) assert.ok(sql.includes(phrase), "missing SQL safety mechanism " + phrase);
  assert.doesNotMatch(sql, /drop table|truncate table|delete from public\.(profiles|wallet_transactions|withdrawals|robux_requests)/i);
});
