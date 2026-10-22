/**
 * FunEarnEzz API — Cloudflare Workers + Supabase.
 * Required Worker secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Set FRONTEND_ORIGIN as a Worker variable. Never expose service-role key to browsers.
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
const cookie = (value, maxAge=60*60*24*7) => `${COOKIE}=${value}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${maxAge}`;
const parseCookies = (request) => Object.fromEntries((request.headers.get("Cookie")||"").split(";").map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf("=");return [x.slice(0,i),x.slice(i+1)];}));
const sb = async (env, path, init={}) => {
  const base = env.SUPABASE_URL.replace(/\/$/,"");
  const res = await fetch(base + path, { ...init, headers: {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type":"application/json",
    ...(init.headers||{})
  }});
  const raw = await res.text();
  let data = null; try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!res.ok) throw new Error(typeof data === "object" ? (data.message||data.msg||data.error_description||data.error||"Supabase request failed") : "Supabase request failed");
  return data;
};
const rest = (env, table, query="", init={}) => sb(env, `/rest/v1/${table}${query ? "?"+query : ""}`, init);
const body = async req => { try { return await req.json(); } catch { return {}; } };
const usernameOK = u => typeof u==="string" && /^[A-Za-z0-9_]{3,24}$/.test(u);
const emailFor = u => u.toLowerCase()+"@"+AUTH_HOST;
const safeProfile = p => p ? ({id:p.id, username:p.username, role:p.role, balance:Number(p.balance||0), reserved_balance:Number(p.reserved_balance||0), created_at:p.created_at}) : null;
async function current(request, env) {
  const token = parseCookies(request)[COOKIE] || (request.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  if (!token) return null;
  try {
    const user = await sb(env, "/auth/v1/user", {headers:{Authorization:"Bearer "+token}});
    const rows = await rest(env,"profiles","id=eq."+encodeURIComponent(user.id)+"&select=*");
    const profile = rows?.[0];
    if (!profile || profile.disabled) return null;
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
  const url=new URL(request.url); let path=url.pathname; const method=request.method;\n  const aliases={"/api/auth/login":"/api/login","/api/auth/register":"/api/register","/api/auth/logout":"/api/logout","/api/tasks":"/api/jobs","/api/submissions/mine":"/api/history","/api/wallet":"/api/wallet"}; path=aliases[path]||path;
  if(method==="OPTIONS") return new Response(null,{status:204,headers:cors(request,env)});
  if(path==="/api/health"&&method==="GET") return reply({ok:true,service:"funearnezz",databaseConfigured:!!(env.SUPABASE_URL&&env.SUPABASE_SERVICE_ROLE_KEY)},200,cors(request,env));
  if(!path.startsWith("/api/")) return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found",{status:404});
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY) return fail("Supabase belum dikonfigurasi di Cloudflare Worker",503,cors(request,env));
  try {
    if(path==="/api/register"&&method==="POST") {
      const b=await body(request), username=String(b.username||"").trim(), password=String(b.password||"");
      if(!usernameOK(username)) return fail("Username harus 3–24 karakter (huruf, angka, underscore)");
      if(password.length<7||!/[A-Za-z]/.test(password)||!/[0-9]/.test(password)) return fail("Password minimal 7 karakter dan harus mengandung huruf serta angka");
      const exists=await rest(env,"profiles","username=ilike."+encodeURIComponent(username)+"&select=id");
      if(exists.length) return fail("Username sudah digunakan",409);
      const created=await sb(env,"/auth/v1/signup",{method:"POST",body:JSON.stringify({email:emailFor(username),password,data:{username}})});
      if(!created?.user?.id) return fail("Pendaftaran gagal");
      const profile={id:created.user.id,username,role:username.toLowerCase()===(env.ADMIN_USERNAME||"syarwanreal").toLowerCase()?"admin":"user",balance:0,reserved_balance:0,disabled:false};
      await rest(env,"profiles","",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(profile)});
      if(created.access_token) return reply({ok:true,user:safeProfile(profile)},200,{...cors(request,env),"Set-Cookie":cookie(created.access_token)});
      return reply({ok:true,message:"Akun dibuat. Silakan login."},200,cors(request,env));
    }
    if(path==="/api/login"&&method==="POST") {
      const b=await body(request), username=String(b.username||"").trim(), password=String(b.password||"");
      if(!usernameOK(username)||!password) return fail("Username atau password salah",401);
      const data=await sb(env,"/auth/v1/token?grant_type=password",{method:"POST",body:JSON.stringify({email:emailFor(username),password})});
      const rows=await rest(env,"profiles","id=eq."+encodeURIComponent(data.user.id)+"&select=*");
      if(!rows[0]||rows[0].disabled) return fail("Akun tidak ditemukan atau dinonaktifkan",403);
      return reply({ok:true,user:safeProfile(rows[0])},200,{...cors(request,env),"Set-Cookie":cookie(data.access_token)});
    }
    if(path==="/api/logout"&&method==="POST") return reply({ok:true},200,{...cors(request,env),"Set-Cookie":cookie("",0)});
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
    if(path==="/api/jobs"&&method==="GET") return reply(await rest(env,"jobs","status=eq.active&select=*&order=created_at.desc"),200,cors(request,env));\n    if(path==="/api/wallet"&&method==="GET") {const s=await requireUser(request,env);return reply({balance:Number(s.profile.balance||0),reserved_balance:Number(s.profile.reserved_balance||0),transactions:[]},200,cors(request,env));}
    let m=path.match(/^\/api\/jobs\/([^/]+)$/);
    if(m&&method==="GET") {const rows=await rest(env,"jobs","id=eq."+encodeURIComponent(m[1])+"&select=*");return rows[0]?reply(rows[0],200,cors(request,env)):fail("Tugas tidak ditemukan",404,cors(request,env));}
    m=path.match(/^\/api\/jobs\/([^/]+)\/submit$/);
    if(m&&method==="POST") {
      const s=await requireUser(request,env), b=await body(request);
      const job=(await rest(env,"jobs","id=eq."+encodeURIComponent(m[1])+"&status=eq.active&select=id,reward"))[0];
      if(!job) return fail("Tugas tidak tersedia",404,cors(request,env));
      const proof_url=String(b.proof_url||b.proof||"").slice(0,2000);
      const rows=await rest(env,"submissions","",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({user_id:s.user.id,job_id:job.id,note:String(b.note||"").slice(0,2000),proof_url,status:"pending"})});
      return reply({ok:true,submission:rows?.[0]},201,cors(request,env));
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
      const s=await requireUser(request,env), b=await body(request), amount=Number(b.amount);
      if(!Number.isFinite(amount)||amount<=0) return fail("Jumlah tidak valid");
      const rows=await rest(env,"robux_requests","",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({user_id:s.user.id,amount,username:String(b.username||b.roblox_username||"").slice(0,100),status:"pending"})});
      return reply({ok:true,request:rows?.[0]},201,cors(request,env));
    }
    if(path==="/api/robux"&&method==="GET") {const s=await requireUser(request,env);return reply(await rest(env,"robux_requests","user_id=eq."+s.user.id+"&select=*&order=created_at.desc"),200,cors(request,env));}
    if(path==="/api/admin/overview"&&method==="GET") {
      await requireAdmin(request,env);
      const [users,jobs,subs,withdrawals]=await Promise.all([rest(env,"profiles","select=id"),rest(env,"jobs","select=id"),rest(env,"submissions","status=eq.pending&select=id"),rest(env,"withdrawals","status=eq.pending&select=id")]);
      return reply({users:users.length,jobs:jobs.length,pending_submissions:subs.length,pending_withdrawals:withdrawals.length},200,cors(request,env));
    }
    if(path==="/api/admin/jobs"&&method==="GET") {await requireAdmin(request,env);return reply(await rest(env,"jobs","select=*&order=created_at.desc"),200,cors(request,env));}
    if(path==="/api/admin/jobs"&&method==="POST") {const s=await requireAdmin(request,env),b=await body(request);if(!b.title||!Number.isFinite(Number(b.reward)))return fail("Judul dan reward wajib diisi");const rows=await rest(env,"jobs","",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({title:String(b.title).slice(0,160),description:String(b.description||"").slice(0,4000),reward:Number(b.reward),status:"active"})});await audit(env,s.user.id,"job.create",{title:b.title});return reply(rows?.[0]||{ok:true},201,cors(request,env));}
    if(path==="/api/admin/submissions"&&method==="GET") {await requireAdmin(request,env);return reply(await rest(env,"submissions","select=*&order=created_at.desc"),200,cors(request,env));}
    if(path==="/api/admin/withdrawals"&&method==="GET") {await requireAdmin(request,env);return reply(await rest(env,"withdrawals","select=*&order=created_at.desc"),200,cors(request,env));}
    if(path==="/api/admin/robux"&&method==="GET") {await requireAdmin(request,env);return reply(await rest(env,"robux_requests","select=*&order=created_at.desc"),200,cors(request,env));}
    if(path==="/api/admin/users"&&method==="GET") {await requireAdmin(request,env);return reply(await rest(env,"profiles","select=id,username,role,balance,reserved_balance,disabled,created_at&order=created_at.desc"),200,cors(request,env));}
    if(path==="/api/admin/audit"&&method==="GET") {await requireAdmin(request,env);return reply(await rest(env,"audit_logs","select=*&order=created_at.desc&limit=200"),200,cors(request,env));}
    m=path.match(/^\/api\/admin\/(submissions|withdrawals|robux)\/([^/]+)\/review$/);
    if(m&&method==="POST") {
      const s=await requireAdmin(request,env),b=await body(request),table={submissions:"submissions",withdrawals:"withdrawals",robux:"robux_requests"}[m[1]];
      if(!["approved","rejected","paid","completed"].includes(b.status))return fail("Status tidak valid");
      const rows=await rest(env,table,"id=eq."+encodeURIComponent(m[2]),{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({status:b.status,review_note:String(b.note||"").slice(0,1000),reviewed_at:new Date().toISOString()})});
      await audit(env,s.user.id,"review."+m[1],{id:m[2],status:b.status});
      return reply({ok:true,item:rows?.[0]},200,cors(request,env));
    }
    m=path.match(/^\/api\/admin\/users\/([^/]+)\/(adjust|toggle)$/);
    if(m&&method==="POST") {
      const s=await requireAdmin(request,env),b=await body(request);
      if(m[2]==="toggle") {const rows=await rest(env,"profiles","id=eq."+encodeURIComponent(m[1]),{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({disabled:!!b.disabled})});await audit(env,s.user.id,"user.toggle",{id:m[1],disabled:!!b.disabled});return reply({ok:true,user:safeProfile(rows?.[0])},200,cors(request,env));}
      const delta=Number(b.amount);if(!Number.isFinite(delta)||delta===0)return fail("Nominal penyesuaian tidak valid");
      const result=await sb(env,"/rest/v1/rpc/admin_adjust_balance",{method:"POST",body:JSON.stringify({p_user_id:m[1],p_amount:delta,p_reason:String(b.reason||"Admin adjustment").slice(0,200)})});
      await audit(env,s.user.id,"user.adjust_balance",{id:m[1],amount:delta});return reply({ok:true,result},200,cors(request,env));
    }
    if(path==="/api/admin/settings"&&method==="POST") {const s=await requireAdmin(request,env),b=await body(request);for(const [key,value] of Object.entries(b)){await rest(env,"settings","on_conflict=key",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({key:String(key).slice(0,100),value})});}await audit(env,s.user.id,"settings.update",{keys:Object.keys(b)});return reply({ok:true},200,cors(request,env));}
    return fail("Endpoint tidak ditemukan",404,cors(request,env));
  } catch(e) {
    const status=e.status||500;
    return reply({error:status===500?"Terjadi kesalahan server. Periksa konfigurasi Supabase dan skema tabel.":e.message},status,cors(request,env));
  }
}
export default {
  async fetch(request,env) {
    try { return await handle(request,env); }
    catch { return fail("Internal server error",500,cors(request,env)); }
  }
};
