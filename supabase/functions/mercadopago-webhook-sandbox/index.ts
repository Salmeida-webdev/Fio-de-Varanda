import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const secret=Deno.env.get("MERCADO_PAGO_TEST_WEBHOOK_SECRET")??"";
const token=Deno.env.get("MERCADO_PAGO_TEST_ACCESS_TOKEN")??"";
const url=Deno.env.get("SUPABASE_URL")??"";
const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??(()=>{try{return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}").default??""}catch{return ""}})();

async function verifySignature(signature:string,requestId:string,dataId:string){
  const parts=Object.fromEntries(signature.split(",").map(x=>x.trim().split("=",2) as [string,string]));
  if(!parts.ts||!parts.v1)return false;
  const manifest=`id:${dataId};request-id:${requestId};ts:${parts.ts};`;
  const cryptoKey=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const digest=new Uint8Array(await crypto.subtle.sign("HMAC",cryptoKey,new TextEncoder().encode(manifest)));
  const expected=[...digest].map(x=>x.toString(16).padStart(2,"0")).join("");
  if(expected.length!==parts.v1.length)return false;
  let diff=0;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^parts.v1.charCodeAt(i);
  return diff===0;
}

const response=(body:string,status=200)=>new Response(body,{status,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}});

Deno.serve(async req=>{
  if(req.method!=="POST")return response("method_not_allowed",405);
  if(!secret||!token||!url||!key)return response("not_configured",503);
  const query=new URL(req.url).searchParams;
  const dataId=query.get("data.id")??"";
  const signature=req.headers.get("x-signature")??"";
  const requestId=req.headers.get("x-request-id")??"";
  if(!dataId||!signature||!requestId||!await verifySignature(signature,requestId,dataId))return response("invalid_signature",401);
  try{
    const notice=await req.json();
    if(notice.type!=="order")return response("ignored_non_order");
    // O simulador pode mandar live_mode=true e type=point mesmo quando o Data ID
    // fornecido é uma Order real de teste. Por isso, o payload serve só para
    // autenticar e identificar; o status vem sempre da API oficial do Mercado Pago.
    if(!/^ORDTST[0-9A-Z]+$/i.test(dataId))return response("ignored_non_test_order");
    const lookup=await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(dataId)}`,{headers:{Authorization:`Bearer ${token}`,Accept:"application/json"}});
    if(!lookup.ok)throw new Error(`test_order_lookup_failed_${lookup.status}`);
    const order=await lookup.json();
    const idMatches=String(order.id)===dataId;
    // Algumas respostas de /v1/orders omitem live_mode. Esta função usa somente o token de teste;
    // rejeita ordens explicitamente live e aceita o campo ausente quando ID e tipo conferem.
    if(!idMatches||order.live_mode===true||order.type!=="online"){
      const reason=!idMatches?"provider_id_mismatch":order.live_mode===true?"provider_order_live_mode":"provider_order_type_not_online";
      console.warn(JSON.stringify({event:"sandbox_order_ignored",reason,data_id_prefix:dataId.slice(0,6),provider_id_matches:idMatches,provider_live_mode:order.live_mode,provider_type:String(order.type??"").slice(0,32)}));
      return response("not_a_store_test_order");
    }
    const orderId=String(order.external_reference??"");
    if(!/^[0-9a-f-]{36}$/i.test(orderId)){
      console.warn(JSON.stringify({event:"sandbox_order_ignored",reason:"external_reference_not_store_uuid",data_id_prefix:dataId.slice(0,6),external_reference_present:Boolean(orderId)}));
      return response("unmatched_order");
    }
    const total=Math.round(Number(order.total_amount)*100);
    const paid=Math.round(Number(order.total_paid_amount)*100);
    if(!Number.isSafeInteger(total)||total<=0||!Number.isSafeInteger(paid)||paid<0)throw new Error("invalid_provider_amount");
    let status="pending";
    if(order.status==="processed"&&paid>=total)status="approved";
    else if(["cancelled","expired","rejected"].includes(String(order.status)))status=order.status==="expired"?"expired":order.status==="rejected"?"rejected":"cancelled";
    console.info(JSON.stringify({event:"sandbox_provider_order_verified",data_id_prefix:dataId.slice(0,6),provider_status:String(order.status??"").slice(0,32),payment_status:status,total_cents:total,paid_cents:paid}));
    const eventId=`${dataId}:${String(notice.id??requestId)}`;
    const saved=await fetch(`${url}/rest/v1/rpc/apply_store_sandbox_payment_event`,{method:"POST",headers:{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({p_event_id:eventId,p_order_id:orderId,p_payment_reference:dataId,p_provider_total_cents:total,p_payment_status:status})});
    const saveResult=await saved.text();
    if(!saved.ok)throw new Error(`sandbox_payment_event_persistence_failed_${saved.status}`);
    console.info(JSON.stringify({event:"sandbox_order_reconciled",data_id_prefix:dataId.slice(0,6),status,total_cents:total,paid_cents:paid,persistence_result:saveResult.slice(0,24)}));
    return response("ok");
  }catch(error){
    console.error(JSON.stringify({event:"sandbox_webhook_processing_failed",reason:error instanceof Error?error.message:"unknown"}));
    return response("retry",500);
  }
});
