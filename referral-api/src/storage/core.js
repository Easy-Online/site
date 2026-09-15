"use strict";
const { TableClient } = require("@azure/data-tables");
const crypto = require("crypto");
const path = require("path");
const dns = require("dns").promises;
const net = require("net");

const TABLE_NAME = process.env.EASYFILE_STORAGE_TABLE || "EasyFileStorageConnections";
const SESSION_TTL_MINUTES = Math.max(15, Number(process.env.EASYFILE_STORAGE_SESSION_TTL_MINUTES || 480));
const MAX_UPLOAD_BYTES = Math.max(1024 * 1024, Number(process.env.EASYFILE_STORAGE_MAX_UPLOAD_BYTES || 50 * 1024 * 1024));
const DEFAULT_RETURN_URL = process.env.EASYFILE_STORAGE_RETURN_URL || "https://www.easyfile.co.za/easy-save.html";

function allowedOrigins() {
  return new Set(String(process.env.EASYFILE_STORAGE_ALLOWED_ORIGINS || process.env.EASYFILE_ALLOWED_ORIGINS || "https://www.easyfile.co.za,https://easyfile.co.za")
    .split(",").map(v => v.trim()).filter(Boolean));
}
function corsHeaders(request) {
  const origin = request.headers.get("origin");
  const headers = {
    "Cache-Control":"no-store","Content-Type":"application/json; charset=utf-8","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff",
    "Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Accept,X-EasyFile-Storage-Session,X-EasyFile-Client","Access-Control-Max-Age":"600","Vary":"Origin"
  };
  if (origin && allowedOrigins().has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
function json(request,status,body){ return {status,headers:corsHeaders(request),jsonBody:body}; }
function preflight(request){ const origin=request.headers.get("origin"); return origin&&!allowedOrigins().has(origin)?json(request,403,{error:"origin_not_allowed"}):{status:204,headers:corsHeaders(request)}; }
function storageSecret(){ const raw=process.env.EASYFILE_STORAGE_ENCRYPTION_KEY||process.env.EASYFILE_EMAIL_HMAC_SECRET||""; if(raw.length<32) throw new Error("storage_encryption_key_not_configured"); return crypto.createHash("sha256").update(`easy-save-storage-v1|${raw}`).digest(); }
function encrypt(value){ const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv("aes-256-gcm",storageSecret(),iv); const data=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]); return Buffer.concat([iv,cipher.getAuthTag(),data]).toString("base64url"); }
function decrypt(value){ const packed=Buffer.from(String(value||""),"base64url"); if(packed.length<29) throw new Error("invalid_encrypted_payload"); const decipher=crypto.createDecipheriv("aes-256-gcm",storageSecret(),packed.subarray(0,12)); decipher.setAuthTag(packed.subarray(12,28)); return JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)),decipher.final()]).toString("utf8")); }
function rowKey(provider,sessionId){ return crypto.createHash("sha256").update(`${provider}|${sessionId}`).digest("hex"); }
async function table(){ const connection=process.env.EASYFILE_STORAGE_CONNECTION_STRING||process.env.AzureWebJobsStorage; if(!connection) throw new Error("storage_connection_not_configured"); const client=TableClient.fromConnectionString(connection,TABLE_NAME); try{await client.createTable();}catch(e){if(e.statusCode!==409)throw e;} return client; }
async function saveSession(provider,sessionId,payload){ const client=await table(),now=Date.now(); await client.upsertEntity({partitionKey:"connector",rowKey:rowKey(provider,sessionId),provider,encrypted:encrypt(payload),createdAt:new Date(now).toISOString(),expiresAt:new Date(now+SESSION_TTL_MINUTES*60000).toISOString()},"Replace"); }
async function loadSession(provider,sessionId){ if(!sessionId||sessionId.length<16||sessionId.length>200) throw new Error("invalid_session"); const client=await table(); let entity; try{entity=await client.getEntity("connector",rowKey(provider,sessionId));}catch(e){if(e.statusCode===404)throw new Error("connector_not_connected");throw e;} if(!entity.expiresAt||Date.parse(entity.expiresAt)<=Date.now()){await client.deleteEntity("connector",entity.rowKey).catch(()=>{});throw new Error("connector_session_expired");} return decrypt(entity.encrypted); }
async function deleteSession(provider,sessionId){ const client=await table(); await client.deleteEntity("connector",rowKey(provider,sessionId)).catch(()=>{}); }
function signState(payload){ const body=Buffer.from(JSON.stringify(payload)).toString("base64url"); const sig=crypto.createHmac("sha256",storageSecret()).update(body).digest("base64url"); return `${body}.${sig}`; }
function verifyState(value){ const [body,sig]=String(value||"").split("."); if(!body||!sig)throw new Error("invalid_oauth_state"); const expected=crypto.createHmac("sha256",storageSecret()).update(body).digest("base64url"),a=Buffer.from(sig),b=Buffer.from(expected); if(a.length!==b.length||!crypto.timingSafeEqual(a,b))throw new Error("invalid_oauth_state"); const payload=JSON.parse(Buffer.from(body,"base64url").toString("utf8")); if(!payload.exp||payload.exp<Date.now())throw new Error("expired_oauth_state"); return payload; }
function validateReturnUrl(input){ const url=new URL(String(input||DEFAULT_RETURN_URL)); if(!allowedOrigins().has(url.origin))throw new Error("return_url_not_allowed"); return url.toString(); }
function callbackUrl(request,provider){ const explicit=process.env.EASYFILE_STORAGE_CALLBACK_BASE; if(explicit)return `${explicit.replace(/\/$/,"")}/${encodeURIComponent(provider)}`; const host=request.headers.get("x-forwarded-host")||request.headers.get("host"),proto=request.headers.get("x-forwarded-proto")||"https"; if(!host)throw new Error("callback_host_unavailable"); return `${proto}://${host}/api/easy-save/oauth/callback/${encodeURIComponent(provider)}`; }

function isPrivateIp(address){
  const ip=String(address||"").toLowerCase();
  if(net.isIP(ip)===4){const p=ip.split(".").map(Number);return p[0]===10||p[0]===127||p[0]===0||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)||(p[0]===100&&p[1]>=64&&p[1]<=127)||(p[0]===198&&(p[1]===18||p[1]===19))||p[0]>=224;}
  if(net.isIP(ip)===6)return ip==="::1"||ip==="::"||ip.startsWith("fc")||ip.startsWith("fd")||/^fe[89ab]/.test(ip)||ip.startsWith("::ffff:127.")||ip.startsWith("::ffff:10.")||ip.startsWith("::ffff:192.168.");
  return false;
}
async function assertPublicEndpoint(input){
  const raw=String(input||"").trim(); if(!raw)throw new Error("storage_endpoint_required");
  let host=raw; try{host=new URL(raw.includes("://")?raw:`https://${raw}`).hostname;}catch{throw new Error("invalid_storage_endpoint");}
  const lower=host.toLowerCase(); if(lower==="localhost"||lower.endsWith(".localhost")||lower.endsWith(".local")||lower.endsWith(".internal"))throw new Error("private_storage_endpoint_blocked");
  const addresses=net.isIP(host)?[{address:host}]:await dns.lookup(host,{all:true,verbatim:true});
  if(!addresses.length||addresses.some(x=>isPrivateIp(x.address)))throw new Error("private_storage_endpoint_blocked");
  return host;
}
function safeName(name){ const cleaned=path.basename(String(name||"file")).replace(/[\u0000-\u001f]/g,"").trim(); return cleaned||"file"; }
function joinRemote(...parts){ return "/"+parts.filter(Boolean).map(v=>String(v).replace(/^\/+|\/+$/g,"")).filter(Boolean).join("/"); }
module.exports={SESSION_TTL_MINUTES,MAX_UPLOAD_BYTES,DEFAULT_RETURN_URL,allowedOrigins,json,preflight,storageSecret,saveSession,loadSession,deleteSession,signState,verifyState,validateReturnUrl,callbackUrl,assertPublicEndpoint,safeName,joinRemote};
