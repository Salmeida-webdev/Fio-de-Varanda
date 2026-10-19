import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const url = Deno.env.get("SUPABASE_URL") ?? "";
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? (()=>{try{return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}").default??""}catch{return ""}})();
const pub = Deno.env.get("STORE_PUBLISHABLE_KEY") ?? (()=>{try{return JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}").default??""}catch{return Deno.env.get("SUPABASE_ANON_KEY")??""}})();
const secret = Deno.env.get("CHECKOUT_SIGNING_SECRET") ?? "";
const meClientId=Deno.env.get("MELHOR_ENVIO_CLIENT_ID")??"", meClientSecret=Deno.env.get("MELHOR_ENVIO_CLIENT_SECRET")??"", meRedirect=Deno.env.get("MELHOR_ENVIO_REDIRECT_URI")??"";
const originZip = (Deno.env.get("STORE_ORIGIN_POSTAL_CODE") ?? "").replace(/\D/g, "");
const meMode = Deno.env.get("MELHOR_ENVIO_MODE") ?? "production";
const apiBase = (Deno.env.get("MELHOR_ENVIO_API_BASE") ?? "https://www.melhorenvio.com.br/api/v2").replace(/\/$/, "");
const allowed = [...new Set([...(Deno.env.get("CORS_ALLOWED_ORIGINS") ?? "http://localhost:4200,http://127.0.0.1:4200").split(",").map(x => x.trim()).filter(Boolean),"http://localhost:4220","http://127.0.0.1:4220","http://localhost:4240","http://127.0.0.1:4240","http://localhost:4241","http://127.0.0.1:4241","http://localhost:4242","http://127.0.0.1:4242","http://localhost:4243","http://127.0.0.1:4243","http://localhost:4244","http://127.0.0.1:4244","http://localhost:4245","http://127.0.0.1:4245","http://localhost:4246","http://127.0.0.1:4246","http://localhost:4247","http://127.0.0.1:4247","http://localhost:4248","http://127.0.0.1:4248","http://localhost:4249","http://127.0.0.1:4249","http://localhost:4250","http://127.0.0.1:4250","http://localhost:4251","http://127.0.0.1:4251","http://localhost:4252","http://127.0.0.1:4252","http://localhost:4253","http://127.0.0.1:4253","http://localhost:4260","http://127.0.0.1:4260","http://localhost:4261","http://127.0.0.1:4261","http://localhost:4262","http://127.0.0.1:4262","http://localhost:4263","http://127.0.0.1:4263","http://localhost:4270","http://127.0.0.1:4270","http://localhost:4271","http://127.0.0.1:4271","http://localhost:4272","http://127.0.0.1:4272","http://localhost:4273","http://127.0.0.1:4273","http://localhost:4280","http://127.0.0.1:4280","http://localhost:4281","http://127.0.0.1:4281","http://localhost:4282","http://127.0.0.1:4282","http://localhost:4283","http://127.0.0.1:4283"])];
const cors = (origin: string | null) => ({"Access-Control-Allow-Origin": origin && allowed.includes(origin) ? origin : "null", "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods":"POST, OPTIONS", "Vary":"Origin"});
const response = (body: unknown, status: number, origin: string | null) => new Response(JSON.stringify(body), {status, headers:{...cors(origin),"Content-Type":"application/json","Cache-Control":"no-store"}});
async function getAccessToken(){
  const lookup=await fetch(`${url}/rest/v1/rpc/get_melhor_envio_token`,{method:"POST",headers:{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:"{}"});
  if(!lookup.ok)return null;const current=await lookup.json();if(!current?.access_token||!current?.refresh_token)return null;
  if(Date.parse(current.expires_at)>Date.now()+120000)return current.access_token;
  const refreshed=await fetch("https://www.melhorenvio.com.br/oauth/token",{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json","User-Agent":"Fio de Varanda (segundoalmeidawebdev@gmail.com)"},body:JSON.stringify({grant_type:"refresh_token",client_id:meClientId,client_secret:meClientSecret,redirect_uri:meRedirect,refresh_token:current.refresh_token})});
  const next=await refreshed.json();if(!refreshed.ok||!next.access_token||!next.refresh_token||!Number(next.expires_in))return null;
  const saved=await fetch(`${url}/rest/v1/rpc/store_melhor_envio_token`,{method:"POST",headers:{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({p_access_token:next.access_token,p_refresh_token:next.refresh_token,p_expires_in:Number(next.expires_in)})});
  return saved.ok?next.access_token:null;
}
async function sign(value: string) {
  const cryptoKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
}
Deno.serve(async (req) => {
  const origin=req.headers.get("origin"); if(req.method==="OPTIONS") return new Response("ok",{headers:cors(origin)});
  if(req.method!=="POST") return response({error:"method_not_allowed"},405,origin);
  if(!origin || !allowed.includes(origin) || !pub || req.headers.get("apikey")!==pub) return response({error:"unauthorized_origin"},401,origin);
  if(meMode!=="production"||!apiBase.startsWith("https://www.melhorenvio.com.br/api/")||!url || !key || secret.length<32 || !meClientId || !meClientSecret || !meRedirect || !originZip) return response({error:"shipping_not_configured",message:"Configure as credenciais de produção e o CEP de origem no Supabase."},503,origin);
  try {
    const body=await req.json();
    const postal=String(body.postal_code??"").replace(/\D/g,"");
    const items=Array.isArray(body.items)?body.items:[];
    if(!/^\d{8}$/.test(postal)||!items.length||items.length>30) return response({error:"invalid_request"},400,origin);
    const ids=[...new Set(items.map(x=>String(x.variant_id??"")))];
    if(ids.some(x=>!/^[0-9a-f-]{36}$/i.test(x))) return response({error:"invalid_product"},400,origin);
    const query=new URLSearchParams({select:"id,price_cents,weight_grams,dimensions_mm,sku,products!inner(name,status,categories!inner(active))",id:`in.(${ids.join(",")})`,active:"eq.true","products.status":"eq.active","products.categories.active":"eq.true"});
    const db=await fetch(`${url}/rest/v1/product_variants?${query}`,{headers:{apikey:key,Authorization:`Bearer ${key}`}});
    if(!db.ok) throw new Error("catalog_lookup_failed");
    const variants=await db.json(); if(variants.length!==ids.length) return response({error:"product_unavailable"},409,origin);
    const byId=new Map(variants.map((v:any)=>[v.id,v]));
    const missing=variants.filter((v:any)=>!v.weight_grams||!v.dimensions_mm||!Number(v.dimensions_mm.width)||!Number(v.dimensions_mm.height)||!Number(v.dimensions_mm.length));
    if(missing.length) return response({error:"shipping_specs_missing",message:"Complete o peso e as dimensões reais dos produtos no painel antes de cotar o frete."},422,origin);
    const products=items.map((item:any)=>{
      const v=byId.get(item.variant_id); const qty=Number(item.quantity); const d=v?.dimensions_mm??{};
      const width=Number(d.width)/10,height=Number(d.height)/10,length=Number(d.length)/10,weight=Number(v.weight_grams)/1000;
      if(!v||!Number.isInteger(qty)||qty<1||qty>10||width<=0||height<=0||length<=0||weight<=0) throw new Error("invalid_cart_or_shipping_specs");
      return {id:v.sku, width, height, length, weight, insurance_value:Number(v.price_cents)*qty/100, quantity:qty};
    });
    const token=await getAccessToken();if(!token)return response({error:"melhor_envio_authorization_missing",message:"Conecte novamente o Melhor Envio na aba Configurações do painel."},503,origin);
    const quote=await fetch(`${apiBase}/me/shipment/calculate`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json",Accept:"application/json","User-Agent":"Fio de Varanda (segundoalmeidawebdev@gmail.com)"},body:JSON.stringify({from:{postal_code:originZip},to:{postal_code:postal},products})});
    const data=await quote.json(); if(!quote.ok) return response({error:"shipping_quote_failed",message:"O Melhor Envio não conseguiu calcular o frete. Confira o cadastro dos produtos, CEPs e permissões do token."},502,origin);
    const options=[];
    for(const q of Array.isArray(data)?data:[]) {
      const value=Number(q.custom_price??q.price); const serviceId=String(q.id??q.service_id??"");
      if(!serviceId||!Number.isFinite(value)||value<0||q.error) continue;
      const snapshot={service_id:serviceId,service_name:String(q.name??q.company?.name??"Entrega"),destination:postal,cart:items.map((x:any)=>({variant_id:String(x.variant_id),quantity:Number(x.quantity)})).sort((a:any,b:any)=>a.variant_id.localeCompare(b.variant_id)),price_cents:Math.round(value*100),delivery_days:Number(q.custom_delivery_time??q.delivery_time??0),quote_id:String(q.id??serviceId),expires_at:Date.now()+15*60*1000,raw:{company:q.company?.name??"",price:value,delivery_time:q.custom_delivery_time??q.delivery_time??null,packages:q.packages??[]}};
      const encoded=btoa(unescape(encodeURIComponent(JSON.stringify(snapshot)))).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
      options.push({...snapshot,quote_token:`${encoded}.${await sign(encoded)}`});
    }
    return response({options},200,origin);
  } catch(e) { return response({error:e instanceof Error?e.message:"shipping_quote_failed"},400,origin); }
});
