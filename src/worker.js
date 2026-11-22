const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization"
};
const json = (data, status=200) => new Response(JSON.stringify(data), {status, headers:{"Content-Type":"application/json; charset=utf-8", ...corsHeaders}});
const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
const random = n => { const b=new Uint8Array(n); crypto.getRandomValues(b); return b; };
async function digest(s){ return hex(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
async function passwordHash(password, salt){
  const key=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({name:"PBKDF2",salt:Uint8Array.from(salt.match(/.{2}/g).map(x=>parseInt(x,16))),iterations:150000,hash:"SHA-256"},key,256));
}
async function body(req){ try{return await req.json();}catch{return null;} }
async function auth(req, env){
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token) return null;
  const h=await digest(token);
  const row=await env.DB.prepare("SELECT users.id, users.username FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>? ").bind(h,Math.floor(Date.now()/1000)).first();
  return row||null;
}
async function issueSession(env,userId){
  const token=hex(random(32)), h=await digest(token), expires=Math.floor(Date.now()/1000)+60*60*24*90;
  await env.DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").bind(h,userId,expires).run();
  return token;
}
export default {
 async fetch(req,env){
  const url=new URL(req.url);
  if(req.method==="OPTIONS") return new Response(null,{headers:corsHeaders});
  if(url.pathname==="/api/health") return json({ok:true,app:"Spor Takip 2.0"});
  if(url.pathname==="/api/register" && req.method==="POST"){
    const b=await body(req);
    if(!b||typeof b.username!=="string"||typeof b.password!=="string") return json({error:"Kullanıcı adı ve şifre gerekli."},400);
    const username=b.username.trim().toLowerCase();
    if(!/^[a-z0-9._-]{3,24}$/.test(username)) return json({error:"Kullanıcı adı 3-24 karakter olmalı; İngilizce harf, rakam, nokta, tire kullan."},400);
    if(b.password.length<8||b.password.length>128) return json({error:"Şifre en az 8 karakter olmalı."},400);
    const salt=hex(random(16)), hash=await passwordHash(b.password,salt), id=crypto.randomUUID();
    try{await env.DB.prepare("INSERT INTO users(id,username,password_salt,password_hash,state_json) VALUES(?,?,?,?,?)").bind(id,username,salt,hash,"{}").run();}
    catch{return json({error:"Bu kullanıcı adı zaten alınmış."},409);}
    return json({token:await issueSession(env,id),username});
  }
  if(url.pathname==="/api/login" && req.method==="POST"){
    const b=await body(req); if(!b||!b.username||!b.password) return json({error:"Kullanıcı adı ve şifre gerekli."},400);
    const row=await env.DB.prepare("SELECT id,username,password_salt,password_hash FROM users WHERE username=?").bind(String(b.username).trim().toLowerCase()).first();
    if(!row||await passwordHash(String(b.password),row.password_salt)!==row.password_hash) return json({error:"Kullanıcı adı veya şifre hatalı."},401);
    return json({token:await issueSession(env,row.id),username:row.username});
  }
  if(url.pathname==="/api/state" && (req.method==="GET"||req.method==="PUT")){
    const user=await auth(req,env); if(!user) return json({error:"Oturum bulunamadı. Yeniden giriş yap."},401);
    if(req.method==="GET"){
      const row=await env.DB.prepare("SELECT state_json FROM users WHERE id=?").bind(user.id).first();
      let state={}; try{state=JSON.parse(row?.state_json||"{}");}catch{}
      return json({state,username:user.username});
    }
    const b=await body(req); if(!b||typeof b.state!=="object") return json({error:"Geçersiz veri."},400);
    const serialized=JSON.stringify(b.state); if(serialized.length>1_500_000) return json({error:"Yedek çok büyük."},413);
    await env.DB.prepare("UPDATE users SET state_json=? WHERE id=?").bind(serialized,user.id).run();
    return json({ok:true,savedAt:new Date().toISOString()});
  }
  if(url.pathname==="/api/logout" && req.method==="POST"){
    const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
    if(token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await digest(token)).run();
    return json({ok:true});
  }
  return env.ASSETS.fetch(req);
 }
};
