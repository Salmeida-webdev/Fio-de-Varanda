import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const secret=Deno.env.get("MERCADO_PAGO_WEBHOOK_SECRET")??"", token=Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN")??"", url=Deno.env.get("SUPABASE_URL")??"", key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??(()=>{try{return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}").default??""}catch{return ""}})();
async function verifySignature(signature:string,requestId:string,dataId:string){
 const parts=Object.fromEntries(signature.split(",").map(x=>x.trim().split("=",2) as [string,string])); if(!parts.ts||!parts.v1)return false;
 const manifest=`id:${dataId};request-id:${requestId};ts:${parts.ts};`;
 const cryptoKey=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const digest=new Uint8Array(await crypto.subtle.sign("HMAC",cryptoKey,new TextEncoder().encode(manifest)));
 const expected=[...digest].map(x=>x.toString(16).padStart(2,"0")).join("");
 if(expected.length!==parts.v1.length)return false;
 let diff=0;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^parts.v1.charCodeAt(i);return diff===0;
}
Deno.serve(async req=>{
 if(req.method!=="POST")return new Response("method_not_allowed",{status:405});
 if(!secret||!token||!url||!key)return new Response("not_configured",{status:503});
 const u=new URL(req.url), id=u.searchParams.get("data.id")??"", signature=req.headers.get("x-signature")??"", requestId=req.headers.get("x-request-id")??"";
 if(!id||!signature||!requestId||!await verifySignature(signature,requestId,id))return new Response("invalid_signature",{status:401});
 try{
  const notice=await req.json(); if(notice.type!=="order") return new Response("ignored",{status:200});
  const fetchOrder=await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${token}`}}); if(!fetchOrder.ok) throw new Error("mercado_pago_order_lookup_failed");
  const order=await fetchOrder.json(); const orderId=String(order.external_reference??""); if(!/^[0-9a-f-]{36}$/i.test(orderId)) return new Response("unmatched",{status:200});
  const stored=await fetch(`${url}/rest/v1/orders?select=id,total_cents,payment_reference&id=eq.${encodeURIComponent(orderId)}&limit=1`,{headers:{apikey:key,Authorization:`Bearer ${key}`}});const rows=await stored.json();const row=rows[0]; if(!row||row.payment_reference!==id)return new Response("unmatched",{status:200});
  if(order.live_mode!==true)return new Response("ignored_test_payment",{status:200});
  const totalCents=Math.round(Number(order.total_amount)*100),paidCents=Math.round(Number(order.total_paid_amount)*100);
  let status="pending";if(order.status==="processed"&&paidCents>=Number(row.total_cents)&&totalCents===Number(row.total_cents))status="approved";else if(["cancelled","expired","rejected"].includes(String(order.status)))status=String(order.status)==="rejected"?"rejected":"cancelled";
  const event=String(notice.id??requestId);
  const rpc=await fetch(`${url}/rest/v1/rpc/apply_store_payment_event`,{method:"POST",headers:{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({p_event_id:event,p_order_id:orderId,p_payment_status:status,p_payment_reference:id})});
  if(!rpc.ok)throw new Error("payment_event_persistence_failed");return new Response("ok",{status:200});
 }catch(_){return new Response("retry",{status:500})}
});
