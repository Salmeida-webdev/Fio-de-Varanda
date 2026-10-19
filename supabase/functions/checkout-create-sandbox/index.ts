import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const url=Deno.env.get("SUPABASE_URL")??"";
const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??(()=>{try{return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}").default??""}catch{return ""}})();
const pub=Deno.env.get("STORE_PUBLISHABLE_KEY")??(()=>{try{return JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}").default??""}catch{return Deno.env.get("SUPABASE_ANON_KEY")??""}})();
const signingSecret=Deno.env.get("CHECKOUT_SIGNING_SECRET")??"";
const mpToken=Deno.env.get("MERCADO_PAGO_TEST_ACCESS_TOKEN")??"";
const site=(Deno.env.get("SITE_URL")??"").replace(/\/$/,"");
const enabled=Deno.env.get("CHECKOUT_TEST_ENABLED")==="true";
const allowed=["http://localhost:4240","http://127.0.0.1:4240","http://localhost:4241","http://127.0.0.1:4241","http://localhost:4242","http://127.0.0.1:4242","http://localhost:4243","http://127.0.0.1:4243","http://localhost:4244","http://127.0.0.1:4244","http://localhost:4245","http://127.0.0.1:4245","http://localhost:4246","http://127.0.0.1:4246","http://localhost:4247","http://127.0.0.1:4247","http://localhost:4248","http://127.0.0.1:4248","http://localhost:4249","http://127.0.0.1:4249","http://localhost:4250","http://127.0.0.1:4250","http://localhost:4251","http://127.0.0.1:4251","http://localhost:4252","http://127.0.0.1:4252","http://localhost:4253","http://127.0.0.1:4253","http://localhost:4260","http://127.0.0.1:4260","http://localhost:4261","http://127.0.0.1:4261","http://localhost:4262","http://127.0.0.1:4262","http://localhost:4263","http://127.0.0.1:4263","http://localhost:4270","http://127.0.0.1:4270","http://localhost:4271","http://127.0.0.1:4271","http://localhost:4272","http://127.0.0.1:4272","http://localhost:4273","http://127.0.0.1:4273","http://localhost:4280","http://127.0.0.1:4280","http://localhost:4281","http://127.0.0.1:4281","http://localhost:4282","http://127.0.0.1:4282","http://localhost:4283","http://127.0.0.1:4283"];
const cors=(origin:string|null)=>({"Access-Control-Allow-Origin":origin&&allowed.includes(origin)?origin:"null","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"});
const out=(body:unknown,status:number,origin:string|null)=>new Response(JSON.stringify(body),{status,headers:{...cors(origin),"Content-Type":"application/json","Cache-Control":"no-store"}});

async function hmac(value:string){
  const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(signingSecret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const bytes=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
}
function canonical(items:any[]){return items.map(x=>({variant_id:String(x.variant_id),quantity:Number(x.quantity)})).sort((a,b)=>a.variant_id.localeCompare(b.variant_id))}

Deno.serve(async req=>{
  const origin=req.headers.get("origin");
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(req.method!=="POST")return out({error:"method_not_allowed"},405,origin);
  if(!origin||!allowed.includes(origin)||!pub||req.headers.get("apikey")!==pub)return out({error:"unauthorized_origin"},401,origin);
  if(!enabled)return out({error:"sandbox_disabled",message:"O checkout de teste ainda não foi habilitado no Supabase."},503,origin);
  if(!url||!key||signingSecret.length<32||!mpToken||!site.startsWith("https://"))return out({error:"sandbox_not_configured",message:"Configure a credencial de teste e as chaves do ambiente de teste no Supabase."},503,origin);

  try{
    const body=await req.json();
    const encoded=String(body.shipping_quote_token??"").split(".");
    if(encoded.length!==2||await hmac(encoded[0])!==encoded[1])return out({error:"invalid_shipping_quote"},400,origin);
    const shipping=JSON.parse(decodeURIComponent(escape(atob(encoded[0].replaceAll("-","+").replaceAll("_","/")))));
    if(Number(shipping.expires_at)<Date.now())return out({error:"shipping_quote_expired",message:"A cotação expirou. Consulte o frete novamente."},409,origin);
    const customer={name:String(body.customer?.name??"").trim(),email:String(body.customer?.email??"").trim(),phone:String(body.customer?.phone??"").trim()};
    const address=body.address??{};
    const postal=String(address.postal_code??"").replace(/\D/g,"");
    if(!customer.name||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)||!customer.phone||!/^\d{8}$/.test(postal)||!address.street||!address.number||!address.district||!address.city||String(address.state??"").length!==2)return out({error:"invalid_customer_or_address"},400,origin);
    if(shipping.destination!==postal)return out({error:"shipping_address_mismatch",message:"O CEP mudou. Consulte novamente as opções de frete."},409,origin);
    const items=Array.isArray(body.items)?body.items:[];
    if(!items.length||items.length>30||JSON.stringify(canonical(shipping.cart??[]))!==JSON.stringify(canonical(items)))return out({error:"shipping_cart_mismatch",message:"A sacola mudou. Consulte novamente o frete."},409,origin);
    const idempotency=String(body.idempotency_key??"");
    if(!/^[0-9a-f-]{36}$/i.test(idempotency))return out({error:"invalid_idempotency_key"},400,origin);

    const rpc=await fetch(`${url}/rest/v1/rpc/create_store_sandbox_order`,{method:"POST",headers:{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({p_idempotency_key:idempotency,p_customer:customer,p_address:address,p_items:items,p_shipping:shipping})});
    const order=await rpc.json();
    if(!rpc.ok)return out({error:"sandbox_order_validation_failed",message:"Não foi possível validar o catálogo demonstrativo. Atualize a página e tente novamente."},409,origin);
    if(order.checkout_url&&order.payment_reference)return out({checkout_url:order.checkout_url,order_id:order.order_id},200,origin);

    const lines=Array.isArray(order.items)?order.items:[];
    const mpItems=lines.map((x:any)=>({title:String(x.name).slice(0,120),quantity:x.quantity,unit_price:(x.unit_price_cents/100).toFixed(2)}));
    mpItems.push({title:`Frete de teste — ${shipping.service_name}`,quantity:1,unit_price:(shipping.price_cents/100).toFixed(2)});
    const mp=await fetch("https://api.mercadopago.com/v1/orders",{method:"POST",headers:{Authorization:`Bearer ${mpToken}`,"Content-Type":"application/json","X-Idempotency-Key":String(order.order_id)},body:JSON.stringify({type:"online",processing_mode:"manual",capture_mode:"automatic_async",expiration_time:"P1D",total_amount:(order.total_cents/100).toFixed(2),external_reference:String(order.order_id),description:"Fio de Varanda — pedido de teste",payer:{email:customer.email},config:{online:{success_url:`${site}/?pagamento=aprovado`,failure_url:`${site}/?pagamento=recusado`,pending_url:`${site}/?pagamento=pendente`,auto_return:"approved"}},items:mpItems})});
    const mpResponseText=await mp.text();
    let created:any={};
    try{created=JSON.parse(mpResponseText)}catch{}
    if(!mp.ok||!created.checkout_url){
      const root=created&&typeof created==="object"&&!Array.isArray(created)?created:{};
      const records=[...(Array.isArray(root.cause)?root.cause:[]),...(Array.isArray(root.errors)?root.errors:[]),...(Array.isArray(root.details)?root.details:[])].filter(x=>x&&typeof x==="object");
      const codeOf=(value:any)=>String(value?.code??value?.error_code??value?.type??"").replace(/[^a-zA-Z0-9_-]/g,"").slice(0,80);
      const errorCode=codeOf(root)||(typeof root.error==="string"?root.error.replace(/[^a-zA-Z0-9_-]/g,"").slice(0,80):"")||records.map(codeOf).find(Boolean)||"unknown";
      const causeCodes=[...new Set(records.map(codeOf).filter(code=>code&&code!==errorCode))].slice(0,4);
      const safeText=(value:any)=>String(value??"").replace(/[\r\n\t]+/g," ").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[email ocultado]").replace(/\b(?:APP_USR|TEST|PROD)-[A-Za-z0-9_-]{8,}\b/g,"[token ocultado]").replace(/\b\d{9,}\b/g,"[número ocultado]").slice(0,180);
      const detail=safeText([root.message,root.description,root.error_description,...records.flatMap((x:any)=>[x.description,x.message])].filter(Boolean).join(" | ")||(!Object.keys(root).length?mpResponseText:""));
      console.error(JSON.stringify({event:"mercado_pago_sandbox_order_failed",http_status:mp.status,error_code:errorCode,cause_codes:causeCodes,error_detail:detail||undefined,response_fields:Object.keys(root).slice(0,12)}));
      const diagnostic=[errorCode,...causeCodes].join("/");
      const message=errorCode==="invalid_email_for_sandbox"||causeCodes.includes("invalid_email_for_sandbox")
        ?"O Mercado Pago rejeitou o e-mail de teste. Use um endereço com domínio @testuser.com e confirme que corresponde à conta Comprador."
        :`O Mercado Pago recusou a order de teste (HTTP ${mp.status}; código ${diagnostic})${detail?`; detalhe: ${detail}`:""}.`;
      return out({error:"mercado_pago_test_error",message,mp_status:mp.status,mp_error_code:errorCode,mp_cause_codes:causeCodes},502,origin);
    }
    const saved=await fetch(`${url}/rest/v1/rpc/save_store_sandbox_checkout`,{method:"POST",headers:{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({p_order_id:order.order_id,p_payment_reference:String(created.id),p_checkout_url:String(created.checkout_url)})});
    if(!saved.ok)throw new Error("sandbox_checkout_persistence_failed");
    return out({checkout_url:created.checkout_url,order_id:order.order_id},200,origin);
  }catch(error){return out({error:error instanceof Error?error.message:"sandbox_checkout_failed"},400,origin)}
});
