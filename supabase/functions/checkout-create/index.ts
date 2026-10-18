import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const url=Deno.env.get("SUPABASE_URL")??"", key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??(()=>{try{return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}").default??""}catch{return ""}})(), pub=Deno.env.get("STORE_PUBLISHABLE_KEY")??(()=>{try{return JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}").default??""}catch{return Deno.env.get("SUPABASE_ANON_KEY")??""}})(), secret=Deno.env.get("CHECKOUT_SIGNING_SECRET")??"";
const mpToken=Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN")??"", mpMode=Deno.env.get("MERCADO_PAGO_MODE")??"production", site=(Deno.env.get("SITE_URL")??"").replace(/\/$/,"");
const enabled=Deno.env.get("CHECKOUT_ENABLED")==="true";
const allowed=(Deno.env.get("CORS_ALLOWED_ORIGINS")??"http://localhost:4200,http://127.0.0.1:4200").split(",").map(x=>x.trim()).filter(Boolean);
const cors=(o:string|null)=>({"Access-Control-Allow-Origin":o&&allowed.includes(o)?o:"null","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"});
const out=(b:unknown,s:number,o:string|null)=>new Response(JSON.stringify(b),{status:s,headers:{...cors(o),"Content-Type":"application/json","Cache-Control":"no-store"}});
async function hmac(value:string){const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const a=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(value)));return btoa(String.fromCharCode(...a)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","")}
Deno.serve(async req=>{
 const origin=req.headers.get("origin"); if(req.method==="OPTIONS") return new Response("ok",{headers:cors(origin)});
 if(req.method!=="POST") return out({error:"method_not_allowed"},405,origin);
 if(!origin||!allowed.includes(origin)||!pub||req.headers.get("apikey")!==pub) return out({error:"unauthorized_origin"},401,origin);
 if(!enabled) return out({error:"checkout_disabled",message:"O checkout permanece fechado até concluir a configuração protegida de produção."},503,origin);
 if(!url||!key||secret.length<32||!mpToken||!site.startsWith("https://")||mpMode!=="production"||!mpToken.startsWith("APP_USR-")) return out({error:"production_not_configured",message:"Falta configurar credencial Mercado Pago APP_USR, URL HTTPS e chave de assinatura no Supabase."},503,origin);
 try {
  const body=await req.json();
  const quote=String(body.shipping_quote_token??"").split("."); if(quote.length!==2||await hmac(quote[0])!==quote[1]) return out({error:"invalid_shipping_quote"},400,origin);
  const shipping=JSON.parse(decodeURIComponent(escape(atob(quote[0].replaceAll("-","+").replaceAll("_","/")))));
  if(Number(shipping.expires_at)<Date.now()) return out({error:"shipping_quote_expired",message:"A cotação expirou. Consulte o frete novamente."},409,origin);
  const customer={name:String(body.customer?.name??"").trim(),email:String(body.customer?.email??"").trim(),phone:String(body.customer?.phone??"").trim()};
  const address=body.address??{}; const normalizedPostal=String(address.postal_code??"").replace(/\D/g,""); if(!customer.name||!/^\S+@\S+\.\S+$/.test(customer.email)||!customer.phone||!/^[0-9]{8}$/.test(normalizedPostal)||!address.street||!address.number||!address.district||!address.city||String(address.state??"").length!==2) return out({error:"invalid_customer_or_address"},400,origin);
  if(shipping.destination!==normalizedPostal) return out({error:"shipping_address_mismatch",message:"O CEP mudou. Consulte novamente as opções de frete."},409,origin);
  const canonical=(arr:any[])=>arr.map(x=>({variant_id:String(x.variant_id),quantity:Number(x.quantity)})).sort((a,b)=>a.variant_id.localeCompare(b.variant_id));
  if(JSON.stringify(canonical(shipping.cart??[]))!==JSON.stringify(canonical(body.items??[]))) return out({error:"shipping_cart_mismatch",message:"A sacola mudou. Consulte novamente as opções de frete."},409,origin);
  const idem=String(body.idempotency_key??""); if(!/^[0-9a-f-]{36}$/i.test(idem)) return out({error:"invalid_idempotency_key"},400,origin);
  const priorResponse=await fetch(`${url}/rest/v1/orders?select=id,payment_status,payment_reference,checkout_url&idempotency_key=eq.${encodeURIComponent(idem)}&limit=1`,{headers:{apikey:key,Authorization:`Bearer ${key}`}});
  const priorRows=priorResponse.ok?await priorResponse.json():[];const prior=priorRows[0];
  if(prior?.checkout_url&&prior.payment_reference)return out({checkout_url:prior.checkout_url,order_id:prior.id},200,origin);
  if(prior&&prior.payment_status!=="pending")return out({error:"checkout_attempt_expired",message:"Esta tentativa expirou ou foi cancelada. Atualize a página para iniciar um novo checkout."},409,origin);
  const rpc=await fetch(`${url}/rest/v1/rpc/create_store_checkout_order`,{method:"POST",headers:{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({p_idempotency_key:idem,p_customer:customer,p_address:address,p_items:body.items,p_shipping:shipping})});
  const order=await rpc.json(); if(!rpc.ok) return out({error:"order_validation_failed",message:"Não foi possível validar estoque e catálogo. Atualize a sacola e tente de novo."},409,origin);
  if(order.checkout_url&&order.payment_reference) return out({checkout_url:order.checkout_url,order_id:order.order_id},200,origin);
  const lines=Array.isArray(order.items)?order.items:[];
  const items=lines.map((x:any)=>({title:String(x.name).slice(0,120),quantity:x.quantity,unit_price:(x.unit_price_cents/100).toFixed(2),total_amount:(x.line_total_cents/100).toFixed(2),unit_measure:"unit"}));
  items.push({title:`Frete — ${shipping.service_name}`,quantity:1,unit_price:(shipping.price_cents/100).toFixed(2),total_amount:(shipping.price_cents/100).toFixed(2),unit_measure:"unit"});
  const mp=await fetch("https://api.mercadopago.com/v1/orders",{method:"POST",headers:{Authorization:`Bearer ${mpToken}`,"Content-Type":"application/json","X-Idempotency-Key":String(order.order_id)},body:JSON.stringify({type:"online",processing_mode:"manual",capture_mode:"automatic_async",expiration_time:"P1D",total_amount:(order.total_cents/100).toFixed(2),external_reference:String(order.order_id),description:"Fio de Varanda — pedido",payer:{email:customer.email},config:{online:{success_url:`${site}/?pagamento=aprovado`,failure_url:`${site}/?pagamento=recusado`,pending_url:`${site}/?pagamento=pendente`,auto_return:"approved"}},items})});
  const created=await mp.json(); if(!mp.ok||!created.checkout_url)return out({error:"mercado_pago_error",message:"Não foi possível abrir o checkout. A reserva temporária será liberada automaticamente; confira a credencial de produção e tente novamente."},502,origin);
  const saved=await fetch(`${url}/rest/v1/orders?id=eq.${encodeURIComponent(order.order_id)}`,{method:"PATCH",headers:{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json",Prefer:"return=minimal"},body:JSON.stringify({payment_reference:created.id,payment_provider:"mercado_pago",checkout_url:created.checkout_url,payment_mode:"production"})});if(!saved.ok)throw new Error("Não foi possível salvar a referência do pagamento. Tente novamente sem abrir outra sacola.");
  return out({checkout_url:created.checkout_url,order_id:order.order_id},200,origin);
 } catch(e) { return out({error:e instanceof Error?e.message:"checkout_failed"},400,origin); }
});
