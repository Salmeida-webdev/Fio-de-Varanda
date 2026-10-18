import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const supa=Deno.env.get("SUPABASE_URL")??"", pub=Deno.env.get("STORE_PUBLISHABLE_KEY")??(()=>{try{return JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}").default??""}catch{return Deno.env.get("SUPABASE_ANON_KEY")??""}})(), service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??(()=>{try{return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}").default??""}catch{return ""}})();
const clientId=Deno.env.get("MELHOR_ENVIO_CLIENT_ID")??"",redirect=Deno.env.get("MELHOR_ENVIO_REDIRECT_URI")??"",signing=Deno.env.get("CHECKOUT_SIGNING_SECRET")??"";
const origins=(Deno.env.get("CORS_ALLOWED_ORIGINS")??"http://localhost:4200,http://127.0.0.1:4200").split(",").map(x=>x.trim()).filter(Boolean);
const headers=(origin:string|null)=>({"Access-Control-Allow-Origin":origin&&origins.includes(origin)?origin:"null","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin","Content-Type":"application/json","Cache-Control":"no-store"});
async function signature(value:string){const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(signing),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const b=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(value)));return btoa(String.fromCharCode(...b)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","")}
Deno.serve(async req=>{
 const origin=req.headers.get("origin");if(req.method==="OPTIONS")return new Response("ok",{headers:headers(origin)});
 if(req.method!=="POST"||!origin||!origins.includes(origin))return new Response(JSON.stringify({error:"unauthorized_origin"}),{status:401,headers:headers(origin)});
 const bearer=req.headers.get("authorization")??"";if(!pub||!service||!clientId||!redirect||signing.length<32||!bearer.startsWith("Bearer ")||req.headers.get("apikey")!==pub)return new Response(JSON.stringify({error:"integration_not_configured"}),{status:503,headers:headers(origin)});
 try{
  const userResponse=await fetch(`${supa}/auth/v1/user`,{headers:{apikey:pub,Authorization:bearer}});if(!userResponse.ok)return new Response(JSON.stringify({error:"unauthorized"}),{status:401,headers:headers(origin)});
  const user=await userResponse.json();const profile=await fetch(`${supa}/rest/v1/admin_profiles?select=user_id&user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&role=eq.admin&limit=1`,{headers:{apikey:service,Authorization:`Bearer ${service}`}});const rows=await profile.json();if(!profile.ok||!rows.length)return new Response(JSON.stringify({error:"admin_required"}),{status:403,headers:headers(origin)});
  const statePayload=btoa(JSON.stringify({admin:user.id,nonce:crypto.randomUUID(),iat:Date.now()})).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
  const state=`${statePayload}.${await signature(statePayload)}`;
  const auth=new URL("https://www.melhorenvio.com.br/oauth/authorize");auth.searchParams.set("client_id",clientId);auth.searchParams.set("redirect_uri",redirect);auth.searchParams.set("response_type","code");auth.searchParams.set("state",state);auth.searchParams.set("scope","shipping-calculate cart-read cart-write shipping-checkout shipping-generate shipping-preview shipping-print shipping-tracking");
  return new Response(JSON.stringify({authorization_url:auth.toString()}),{status:200,headers:headers(origin)});
 }catch{return new Response(JSON.stringify({error:"oauth_start_failed"}),{status:500,headers:headers(origin)})}
});
