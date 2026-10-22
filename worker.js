/**
 * FunEarnEzz API — Cloudflare Workers + Supabase.
 * Required Worker secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Set FRONTEND_ORIGIN as a Worker variable. Never expose service-role key to browsers.
 * Public registration always creates a regular user; provision admins separately in Supabase.
 *
 * Database schema is intentionally configured separately in Supabase. Expected tables:
 * profiles(id, username, role, balance, reserved_balance, disabled, created_at),
 * jobs(id, title, description, reward, status, created_at),
 * submissions(id, user_id, job_id, note, proof_url, status, created_at),
 * withdrawals(id, user_id, amount, method, destination, status, created_at),
 * robux_requests(id, user_id, amount, username, status, created_at),
 * settings(key, value), audit_logs(id, actor_id, action, details, created_at).
 */
const COOKIE = "fe_session";
const AUTH_HOST = "users.funearnezz.invalid";
const cors = (request, env) => {
  const origin = request.headers.get("Origin");
  const headers = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400"
  };
  if (origin && env.FRONTEND_ORIGIN && origin === env.FRONTEND_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
};
const reply = (data, status=200, headers={}) => new Response(JSON.stringify(data), {
  status, headers: { "content-type":"application/json; charset=utf-8", "cache-control":"no-store", ...headers }
});
const fail = (message, status=400, headers={}) => reply({error:message}, status, headers);
const cookie = (value, maxAge=60*60) => `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.max(0,Math.floor(maxAge))}`;
const parseCookies = (request) => Object.fromEntries((request.headers.get("Cookie")||"").split(";").map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf("=");return [x.slice(0,i),x.slice(i+1)];}));
const sb = async (env, path, init={}) => {
  const base = env.SUPABASE_URL.replace(/\/$/,"");
  const serverKey = env.SUPABASE_SERVICE_ROLE_KEY;
  // Supabase Auth endpoints use the project's publishable key as apikey.
  // Keep the secret/service-role key for server-side Data API requests only.
  const isAuthEndpoint = path.startsWith("/auth/v1/");
  const requestKey = isAuthEndpoint ? env.SUPABASE_PUBLISHABLE_KEY : serverKey;
  if (!requestKey) throw new Error(isAuthEndpoint ? "Supabase publishable key is missing" : "Supabase server key is missing");
  const authHeaders = { apikey: requestKey };
  // Legacy service_role JWTs need a Bearer header for Data API; sb_secret keys do not.
  if (!isAuthEndpoint && (serverKey.match(/\./g) || []).length === 2) authHeaders.Authorization = `Bearer ${serverKey}`;
  const res = await fetch(base + path, { ...init, headers: {
    ...authHeaders,
    "Content-Type":"application/json",
    ...(init.headers||{})
  }});
  const raw = await res.text();
  let data = null; try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!res.ok) { const err = new Error(typeof data === "object" ? (data.message||data.msg||data.error_description||data.error||"Supabase request failed") : "Supabase request failed"); err.upstreamStatus = res.status; throw err; }
  return data;
};
// Admin Auth operations must use the server-side secret/service-role key, never the public key.
const sbAdmin = async (env, path, init={}) => {
  const base = env.SUPABASE_URL.replace(/\/$/,"");
  const serverKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serverKey) throw new Error("Supabase server key is missing");
  const headers = { apikey: serverKey };
  // Legacy service-role JWTs also require Authorization; sb_secret_ keys authenticate via apikey.
  if ((serverKey.match(/\./g) || []).length === 2) headers.Authorization = `Bearer ${serverKey}`;
  const res = await fetch(base + path, { ...init, headers: {
    ...headers,
    "Content-Type":"application/json",
    ...(init.headers||{})
  }});
  const raw = await res.text();
  let data = null; try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!res.ok) {
    const message = typeof data === "object" && data
      ? (data.message || data.msg || data.error_description || data.error || "Supabase admin request failed")
      : "Supabase admin request failed";
    const err = new Error(String(message).slice(0, 500)); err.upstreamStatus = res.status; throw err;
  }
  return data;
};
const rest = (env, table, query="", init={}) => sb(env, `/rest/v1/${table}${query ? "?"+query : ""}`, init);
const body = async req => {
  const type = (req.headers.get("Content-Type") || "").toLowerCase();
  if (type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")) {
    try { return Object.fromEntries((await req.formData()).entries()); } catch { return {}; }
  }
  try { return await req.json(); } catch { return {}; }
};
const usernameOK = u => typeof u==="string" && /^[A-Za-z0-9_]{3,24}$/.test(u);
const emailFor = u => u.toLowerCase()+"@"+AUTH_HOST;
const isDisabled = p => Boolean(p?.disabled ?? p?.disable ?? false);\nconst safeProfile = p => p ? ({id:p.id, username:p.username, role:p.role, balance:Number(p.balance||0), reserved_balance:Number(p.reserved_balance||0), created_at:p.created_at}) : null;
async function current(request, env) {
  const token = parseCookies(request)[COOKIE] || (request.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  if (!token) return null;
  try {
    const user = await sb(env, "/auth/v1/user", {headers:{Authorization:"Bearer "+token}});
    const rows = await rest(env,"profiles","id=eq."+encodeURIComponent(user.id)+"&select=*");
    const profile = rows?.[0];
    if (!profile || isDisabled(profile)) return null;
    return {user, profile, token};
  } catch { return null; }
}
async function requireUser(request,env) {
  const session=await current(request,env);
  if(!session) throw Object.assign(new Error("Silakan login terlebih dahulu"),{status:401});
  return session;
}
async function requireAdmin(request,env) {
  const session=await requireUser(request,env);
  if(session.profile.role!=="admin") throw Object.assign(new Error("Akses admin ditolak"),{status:403});
  return session;
}
async function audit(env, actor, action, details={}) {
  try { await rest(env,"audit_logs","",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({actor_id:actor,action,details})}); } catch {}
}
async function handle(request,env) {
  const url=new URL(request.url); let path=url.pathname; const method=request.method;
  const aliases={"/api/auth/login":"/api/login","/api/auth/register":"/api/register","/api/auth/logout":"/api/logout","/api/tasks":"/api/jobs","/api/submissions/mine":"/api/history","/api/wallet":"/api/wallet"}; path=aliases[path]||path;
  if(method==="OPTIONS") return new Response(null,{status:204,headers:cors(request,env)});
  if(path==="/api/health"&&method==="GET") return reply({ok:true,service:"funearnezz",databaseConfigured:!!(env.SUPABASE_URL&&env.SUPABASE_PUBLISHABLE_KEY&&env.SUPABASE_SERVICE_ROLE_KEY)},200,cors(request,env));
  if(path==="/api/maintenance"&&method==="GET") {\n    try {\n      if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY) return reply({enabled:false,reason:"",reopenAt:""},200,cors(request,env));\n      const rows=await rest(env,"settings","key=in.(maintenanceEnabled,maintenanceReason,maintenanceReopenAt)&select=key,value");\n      const cfg=Object.fromEntries((rows||[]).map(row=>[row.key,row.value]));\n      const enabled=cfg.maintenanceEnabled===true||String(cfg.maintenanceEnabled).toLowerCase()==="true";\n      return reply({enabled,reason:String(cfg.maintenanceReason||""),reopenAt:String(cfg.maintenanceReopenAt||"")},200,cors(request,env));\n    } catch(error) { return reply({enabled:false,reason:"",reopenAt:""},200,cors(request,env)); }\n  }
  if(!path.startsWith("/api/")) return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found",{status:404});
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY) return fail("Supabase belum dikonfigurasi di Cloudflare Worker",503,cors(request,env));
  try {
    if((path==="/api/register"||path==="/api/auth/register")&&method==="POST") {
      const b=await body(request), username=String(b.username||"").trim(), password=String(b.password||"");
      if(!usernameOK(username)) return fail("Username harus 3–24 karakter (huruf, angka, underscore)");
      if(password.length<8||!/[A-Za-z]/.test(password)||!/[0-9]/.test(password)) return fail("Password minimal 8 karakter dan harus mengandung huruf serta angka");
      const exists=await rest(env,"profiles","username=ilike."+encodeURIComponent(username)+"&select=id");
      if(exists.length) return fail("Username sudah digunakan",409);
      // This app uses synthetic internal emails for username-only accounts. Public signup can
      // fail with an Auth 500 when Supabase confirmation-email delivery is enabled. Create the
      // account server-side as confirmed, using the secret key, so no email is sent.
      const created=await sbAdmin(env,"/auth/v1/admin/users",{method:"POST",body:JSON.stringify({
        email:emailFor(username),
        password,
        email_confirm:true,
        user_metadata:{username}
      })});
      if(!created?.id) return fail("Pendaftaran gagal");
      const profile={id:created.id,username,role:"user",balance:0,reserved_balance:0};
      try {
        // Auth trigger may already create this row; upsert prevents duplicate primary-key errors.
        await rest(env,"profiles","on_conflict=id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(profile)});
      } catch (profileError) {
        // Roll back the Auth user if profile creation fails, avoiding orphaned usernames.
        try { await sbAdmin(env,"/auth/v1/admin/users/"+encodeURIComponent(created.id),{method:"DELETE"}); } catch {}
        throw profileError;
      }
      return reply({ok:true,message:"Akun berhasil dibuat. Silakan login."},201,cors(request,env));
    }
    if((path==="/api/login"||path==="/api/auth/login")&&method==="POST") {
      const b=await body(request), username=String(b.username||"").trim(), password=String(b.password||"");
      if(!usernameOK(username)||!password) return fail("Username atau password salah",401);
      const data=await sb(env,"/auth/v1/token?grant_type=password",{method:"POST",body:JSON.stringify({email:emailFor(username),password})});
      const rows=await rest(env,"profiles","id=eq."+encodeURIComponent(data.user.id)+"&select=*");
      if(!rows[0]||isDisabled(rows[0])) return fail("Akun tidak ditemukan atau dinonaktifkan",403);
      return reply({ok:true,user:safeProfile(rows[0])},200,{...cors(request,env),"Set-Cookie":cookie(data.access_token,Math.min(86400,Math.max(60,Number(data.expires_in)||3600)))});
    }
    if((path==="/api/logout"||path==="/api/auth/logout")&&method==="POST") return reply({ok:true},200,{...cors(request,env),"Set-Cookie":cookie("",0)});
    if(path==="/api/me"&&method==="GET") {const s=await requireUser(request,env);return reply({user:safeProfile(s.profile)},200,cors(request,env));}
    if(path==="/api/config"&&method==="GET") return reply({captchaRequired:false,appName:"FunEarnEzz"},200,cors(request,env));
    if(path==="/api/dashboard"&&method==="GET") {
      const s=await requireUser(request,env);
      const [jobs,submissions,withdrawals]=await Promise.all([
        rest(env,"jobs","status=eq.active&select=id,title,description,reward,status&order=created_at.desc"),
        rest(env,"submissions","user_id=eq."+s.user.id+"&select=id,status&order=created_at.desc"),
        rest(env,"withdrawals","user_id=eq."+s.user.id+"&select=id,status,amount&order=created_at.desc")
      ]);
      return reply({user:safeProfile(s.profile),jobs,stats:{submissions:submissions.length,withdrawals:withdrawals.length}},200,cors(request,env));
    }
    if(path==="/api/jobs"&&method==="GET") return reply(await rest(env,"jobs","status=eq.active&select=*&order=created_at.desc"),200,cors(request,env));
    if(path==="/api/wallet"&&method==="GET") {const s=await requireUser(request,env);const transactions=await rest(env,"wallet_transactions","user_id=eq."+s.user.id+"&select=*&order=created_at.desc&limit=100");return reply({balance:Number(s.profile.balance||0),reserved_balance:Number(s.profile.reserved_balance||0),transactions},200,cors(request,env));}
    let m=path.match(/^\/api\/jobs\/([^/]+)$/);
    if(m&&method==="GET") {const rows=await rest(env,"jobs","id=eq."+encodeURIComponent(m[1])+"&select=*");return rows[0]?reply(rows[0],200,cors(request,env)):fail("Tugas tidak ditemukan",404,cors(request,env));}
    m=path.match(/^\/api\/jobs\/([^/]+)\/submit$/);
    if(m&&method==="POST") {
      const s=await requireUser(request,env), b=await body(request);
      const job=(await rest(env,"jobs","id=eq."+encodeURIComponent(m[1])+"&status=eq.active&select=id,reward"))[0];
      if(!job) return fail("Tugas tidak tersedia",404,cors(request,env));
      const file=b.proof;
      if (!file || typeof file.arrayBuffer!=="function" || !Number.isFinite(file.size)) return fail("Pilih gambar bukti yang valid.",400,cors(request,env));
      if (file.size<1 || file.size>5*1024*1024) return fail("Ukuran gambar maksimal 5 MB.",413,cors(request,env));
      const mime=String(file.type||"").toLowerCase();
      const ext=({"image/jpeg":"jpg","image/png":"png","image/webp":"webp"})[mime];
      if (!ext) return fail("Format gambar yang didukung: JPG, PNG, atau WEBP.",415,cors(request,env));
      const proofPath=s.user.id+"/"+crypto.randomUUID()+"."+ext;
      const encodedPath=proofPath.split("/").map(encodeURIComponent).join("/");
      await sb(env,"/storage/v1/object/submission-proofs/"+encodedPath,{method:"POST",headers:{"Content-Type":mime,"x-upsert":"false"},body:await file.arrayBuffer()});
      const rows=await rest(env,"submissions","",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({user_id:s.user.id,job_id:job.id,note:String(b.note||"").slice(0,2000),proof_url:proofPath,status:"pending"})});
      return reply({ok:true,submission:rows?.[0]},201,cors(request,env));
    }
    m=path.match(/^\/api\/submissions\/([^/]+)\/proof$/);
    if(m&&method==="GET") {
      const s=await requireUser(request,env);
      const row=(await rest(env,"submissions","id=eq."+encodeURIComponent(m[1])+"&select=id,user_id,proof_url"))[0];
      if(!row) return fail("Bukti tidak ditemukan.",404,cors(request,env));
      if(row.user_id!==s.user.id && s.profile.role!=="admin") return fail("Akses ditolak.",403,cors(request,env));
      if(!row.proof_url) return fail("Pengajuan ini tidak memiliki gambar bukti.",404,cors(request,env));
      const objectPath=String(row.proof_url).split("/").map(encodeURIComponent).join("/");
      const signed=await sb(env,"/storage/v1/object/sign/submission-proofs/"+objectPath,{method:"POST",body:JSON.stringify({expiresIn:300})});
      const raw=signed.signedURL||signed.signedUrl;
      if(!raw) throw new Error("Storage tidak mengembalikan signed URL.");
      const signedUrl=raw.startsWith("http")?raw:env.SUPABASE_URL.replace(/\/$/,"")+"/storage/v1"+(raw.startsWith("/")?raw:"/"+raw);
      return reply({url:signedUrl,expiresIn:300},200,cors(request,env));
    }
    if(path==="/api/history"&&method==="GET") {
      const s=await requireUser(request,env);
      const [submissions,withdrawals,robux]=await Promise.all([
        rest(env,"submissions","user_id=eq."+s.user.id+"&select=*&order=created_at.desc"),
        rest(env,"withdrawals","user_id=eq."+s.user.id+"&select=*&order=created_at.desc"),
        rest(env,"robux_requests","user_id=eq."+s.user.id+"&select=*&order=created_at.desc")
      ]);
      return reply({submissions,withdrawals,robux},200,cors(request,env));
    }
    if(path==="/api/withdrawals"&&method==="POST") {
      const s=await requireUser(request,env), b=await body(request), amount=Number(b.amount);
      if(!Number.isFinite(amount)||amount<=0||amount>Number(s.profile.balance||0)) return fail("Saldo tidak mencukupi atau jumlah tidak valid");
      const rows=await sb(env,"/rest/v1/rpc/create_withdrawal",{method:"POST",body:JSON.stringify({p_user_id:s.user.id,p_amount:amount,p_method:String(b.method||"").slice(0,50),p_destination:String(b.destination||"").slice(0,200)})});
      return reply({ok:true,result:rows},201,cors(request,env));
    }
    if(path==="/api/robux"&&method==="POST") {
      const s=await requireUser(request,env), b=await body(request);
      const settings=await rest(env,"settings","select=key,value");
      const cfg=Object.fromEntries((settings||[]).map(x=>[x.key,x.value]));
      const min=Math.max(1,Number(cfg.robuxMin||10));
      const methodName=String(b.method||"").toLowerCase();
      const robux=Number(b.robux);
      const username=String(b.username||b.roblox_username||"").trim().slice(0,100);
      const gamepassUrl=String(b.gamepassUrl||b.gamepass_url||"").trim().slice(0,500);
      if(!["gamepass","username"].includes(methodName)) return fail("Pilih metode Game Pass atau Via Username.");
      if(!Number.isSafeInteger(robux)||robux<min) return fail("Minimal penukaran "+min+" Robux.");
      if(!username) return fail("Username Roblox wajib diisi.");
      if(methodName==="gamepass" && !/^https:\/\/www\.roblox\.com\//i.test(gamepassUrl)) return fail("Link Game Pass Roblox wajib diisi dengan URL HTTPS yang valid.");
      const rate=Number(methodName==="gamepass"?(cfg.gamepassRate||170):(cfg.usernameRate||230));
      const cost=robux*rate;
      if(!Number.isSafeInteger(rate)||rate<1||!Number.isSafeInteger(cost)) return fail("Tarif atau total potongan tidak valid.");
      // This RPC must atomically check available balance, reserve the cost, and persist method/rate/cost.
      const created=await sb(env,"/rest/v1/rpc/create_robux_request",{method:"POST",body:JSON.stringify({p_user_id:s.profile.id,p_method:methodName,p_robux:robux,p_username:username,p_gamepass_url:methodName==="gamepass"?gamepassUrl:"",p_rate:rate,p_cost:cost})});
      await audit(env,s.profile.id,"robux_request_created",{method:methodName,robux,rate,cost});
      return reply({ok:true,request:created,method:methodName,robux,rate,cost,message:"Permintaan dikirim. Saldo yang ditahan: Rp "+cost.toLocaleString("id-ID")+"."},201,cors(request,env));
    }
    if(path==="/api/robux"&&method==="GET") {const s=await requireUser(request,env);return reply(await rest(env,"robux_requests","user_id=eq."+s.user.id+"&select=*&order=created_at.desc"),200,cors(request,env));}
    if(path==="/api/admin/overview"&&method==="GET") {
      await requireAdmin(request,env);
      const [users,jobs,subs,withdrawals]=await Promise.all([rest(env,"profiles","select=id"),rest(env,"jobs","select=id"),rest(env,"submissions","status=eq.pending&select=id"),rest(env,"withdrawals","status=eq.pending&select=id")]);
      const robux=await rest(env,"robux_requests","status=eq.pending&select=id");
      return reply({users:users.length,jobs:jobs.length,pending_submissions:subs.length,pending_withdrawals:withdrawals.length,pending_robux:robux.length},200,cors(request,env));
    }
    if(path==="/api/admin/jobs"&&method==="GET") {await requireAdmin(request,env);return reply(await rest(env,"jobs","select=*&order=created_at.desc"),200,cors(request,env));}
    if(path==="/api/admin/jobs"&&method==="POST") {const s=await requireAdmin(request,env),b=await body(request);if(!String(b.title||"").trim()||!Number.isFinite(Number(b.reward))||Number(b.reward)<0)return fail("Judul wajib diisi dan reward harus berupa angka nol atau lebih.",400,cors(request,env));const rows=await rest(env,"jobs","",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({title:String(b.title).slice(0,160),description:String(b.description||"").slice(0,4000),reward:Number(b.reward),status:"active"})});await audit(env,s.user.id,"job.create",{title:b.title});return reply(rows?.[0]||{ok:true},201,cors(request,env));}
    if(path==="/api/admin/submissions"&&method==="GET") {await requireAdmin(request,env);return reply(await rest(env,"submissions","select=*&order=created_at.desc"),200,cors(request,env));}
    if(path==="/api/admin/withdrawals"&&method==="GET") {await requireAdmin(request,env);return reply(await rest(env,"withdrawals","select=*&order=created_at.desc"),200,cors(request,env));}
    if(path==="/api/admin/robux"&&method==="GET") {await requireAdmin(request,env);return reply(await rest(env,"robux_requests","select=*&order=created_at.desc"),200,cors(request,env));}
    if(path==="/api/admin/users"&&method==="GET") {await requireAdmin(request,env);return reply(await rest(env,"profiles","select=*&order=created_at.desc"),200,cors(request,env));}
    if(path==="/api/admin/audit"&&method==="GET") {await requireAdmin(request,env);return reply(await rest(env,"audit_logs","select=*&order=created_at.desc&limit=200"),200,cors(request,env));}
    m=path.match(/^\/api\/admin\/(submissions|withdrawals|robux)\/([^/]+)\/review$/);
    if(m&&method==="POST") {
      const s=await requireAdmin(request,env),b=await body(request);
      const allowed={submissions:["approved","rejected"],withdrawals:["paid","rejected"],robux:["completed","rejected"]};
      if(!allowed[m[1]].includes(b.status))return fail("Status tidak valid untuk jenis pengajuan.",400,cors(request,env));
      const rpc={submissions:["review_submission","p_submission_id"],withdrawals:["review_withdrawal","p_withdrawal_id"],robux:["review_robux_request","p_robux_request_id"]}[m[1]];
      const args={ [rpc[1]]:m[2],p_status:b.status,p_note:String(b.note||"").slice(0,1000),p_admin_id:s.user.id};
      const result=await sb(env,"/rest/v1/rpc/"+rpc[0],{method:"POST",body:JSON.stringify(args)});
      await audit(env,s.user.id,"review."+m[1],{id:m[2],status:b.status});
      return reply({ok:true,item:result},200,cors(request,env));
    }
    m=path.match(/^\/api\/admin\/users\/([^/]+)\/(adjust|toggle)$/);
    if(m&&method==="POST") {
      const s=await requireAdmin(request,env),b=await body(request);
      if(m[2]==="toggle") {const rows=await rest(env,"profiles","id=eq."+encodeURIComponent(m[1]),{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({disable:!!b.disabled})});await audit(env,s.user.id,"user.toggle",{id:m[1],disabled:!!b.disabled});return reply({ok:true,user:safeProfile(rows?.[0])},200,cors(request,env));}
      const delta=Number(b.amount);if(!Number.isFinite(delta)||delta===0)return fail("Nominal penyesuaian tidak valid");
      const result=await sb(env,"/rest/v1/rpc/admin_adjust_balance",{method:"POST",body:JSON.stringify({p_user_id:m[1],p_amount:delta,p_reason:String(b.reason||"Admin adjustment").slice(0,200)})});
      await audit(env,s.user.id,"user.adjust_balance",{id:m[1],amount:delta});return reply({ok:true,result},200,cors(request,env));
    }
    if(path==="/api/admin/settings"&&method==="GET") {await requireAdmin(request,env);return reply(await rest(env,"settings","select=key,value&order=key.asc"),200,cors(request,env));}
    if(path==="/api/admin/settings"&&method==="POST") {const s=await requireAdmin(request,env),b=await body(request);for(const [key,value] of Object.entries(b)){await rest(env,"settings","on_conflict=key",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({key:String(key).slice(0,100),value})});}await audit(env,s.user.id,"settings.update",{keys:Object.keys(b)});return reply({ok:true},200,cors(request,env));}
    return fail("Endpoint tidak ditemukan",404,cors(request,env));
  } catch(e) {
    let status=e.status||e.upstreamStatus||500;
    if(path==="/api/login" && e.upstreamStatus===400) status=401;
    if(path==="/api/register" && e.upstreamStatus===400 && /already|duplicate|unique/i.test(String(e.message))) status=409;
    if(status<400||status>599) status=500;
    // Keep credentials and request bodies out of logs; log only route, status, and upstream error message.
    console.error("FunEarnEzz API request failed", {
      path,
      method,
      status,
      error: String(e?.message || "Unknown error").slice(0, 500)
    });
    const publicMessage=status===500?"Terjadi kesalahan server. Periksa konfigurasi Supabase dan skema tabel.":String(e?.message||"Permintaan gagal").slice(0,300);
    return reply({error:publicMessage},status,cors(request,env));
  }
}
export default {
  async fetch(request,env) {
    try { return await handle(request,env); }
    catch { return fail("Internal server error",500,cors(request,env)); }
  }
};
