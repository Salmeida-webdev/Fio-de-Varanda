import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? (() => {
  try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default ?? ""; }
  catch { return ""; }
})();
const testToken = Deno.env.get("MERCADO_PAGO_TEST_ACCESS_TOKEN") ?? "";
const allowedOrigins = new Set([
  ...(Deno.env.get("CORS_ALLOWED_ORIGINS") ?? "").split(",").map(value => value.trim()).filter(Boolean),
  "https://fiodevaranda.netlify.app",
  "http://localhost:4248",
  "http://127.0.0.1:4248",
  "http://localhost:4249",
  "http://127.0.0.1:4249",
  "http://localhost:4250",
  "http://127.0.0.1:4250",
  "http://localhost:4251",
  "http://127.0.0.1:4251",
  "http://localhost:4252",
  "http://127.0.0.1:4252",
  "http://localhost:4253",
  "http://127.0.0.1:4253",
  "http://localhost:4260",
  "http://127.0.0.1:4260",
  "http://localhost:4261",
  "http://127.0.0.1:4261",
  "http://localhost:4262",
  "http://127.0.0.1:4262",
  "http://localhost:4263",
  "http://127.0.0.1:4263",
  "http://localhost:4270",
  "http://127.0.0.1:4270",
  "http://localhost:4271",
  "http://127.0.0.1:4271",
  "http://localhost:4272",
  "http://127.0.0.1:4272",
  "http://localhost:4273",
  "http://127.0.0.1:4273",
  "http://localhost:4280",
  "http://127.0.0.1:4280",
  "http://localhost:4281",
  "http://127.0.0.1:4281",
  "http://localhost:4282",
  "http://127.0.0.1:4282",
  "http://localhost:4283",
  "http://127.0.0.1:4283",
]);

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function out(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function cents(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const match = String(value).match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const amount = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(amount) ? amount : null;
}

async function requireActiveAdmin(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  const publicKey = req.headers.get("apikey") ?? "";
  if (!bearer || !publicKey || !serviceKey || !supabaseUrl) throw new Error("admin_auth_required");

  const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publicKey, Authorization: `Bearer ${bearer}` },
  });
  if (!authResponse.ok) throw new Error("admin_auth_required");
  const user = await authResponse.json();
  if (typeof user?.id !== "string") throw new Error("admin_auth_required");

  const profileUrl = new URL(`${supabaseUrl}/rest/v1/admin_profiles`);
  profileUrl.search = new URLSearchParams({
    select: "user_id",
    user_id: `eq.${user.id}`,
    role: "eq.admin",
    active: "eq.true",
    limit: "1",
  }).toString();
  const profileResponse = await fetch(profileUrl, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!profileResponse.ok) throw new Error("admin_profile_lookup_failed");
  const profiles = await profileResponse.json();
  if (!Array.isArray(profiles) || profiles.length !== 1 || profiles[0].user_id !== user.id) {
    throw new Error("admin_access_required");
  }
  return user.id as string;
}

Deno.serve(async req => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return out({ error: "method_not_allowed" }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return out({ error: "origin_not_allowed" }, 403, origin);
  if (!supabaseUrl || !serviceKey || !testToken) {
    const missing = { supabase_url: !supabaseUrl, supabase_service_key: !serviceKey, mercado_pago_test_token: !testToken };
    console.error(JSON.stringify({ event: "sandbox_manual_sync_not_configured", missing }));
    const message = !testToken
      ? "A credencial de teste do Mercado Pago não está configurada no Supabase."
      : "O acesso administrativo do Supabase não está configurado nessa função.";
    return out({ error: "sandbox_sync_not_configured", message }, 503, origin);
  }

  try {
    await requireActiveAdmin(req);
    const body = await req.json();
    const paymentReference = String(body?.payment_reference ?? "");
    if (!/^ORDTST[0-9A-Z]+$/.test(paymentReference)) {
      return out({ error: "invalid_test_order_reference", message: "Informe o ID de um pedido ORDTST válido." }, 400, origin);
    }

    const lookupResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/lookup_store_sandbox_order_for_sync`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_payment_reference: paymentReference }),
    });
    if (!lookupResponse.ok) throw new Error("sandbox_order_lookup_failed");
    const lookupRows = await lookupResponse.json();
    const localOrder = Array.isArray(lookupRows) ? lookupRows[0] : null;
    if (!localOrder || localOrder.payment_reference !== paymentReference) {
      return out({ error: "sandbox_order_not_found", message: "Esse pedido de teste não foi encontrado no backend da loja." }, 404, origin);
    }

    const providerResponse = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(paymentReference)}`, {
      headers: { Authorization: `Bearer ${testToken}`, Accept: "application/json" },
    });
    if (!providerResponse.ok) {
      console.warn(JSON.stringify({ event: "sandbox_manual_sync_provider_lookup_failed", status: providerResponse.status, reference_prefix: paymentReference.slice(0, 8) }));
      return out({ error: "provider_order_lookup_failed", message: "O Mercado Pago não retornou esse pedido pela credencial de teste." }, 502, origin);
    }
    const providerOrder = await providerResponse.json();
    const totalCents = cents(providerOrder.total_amount);
    const paidCents = cents(providerOrder.total_paid_amount ?? "0");
    if (String(providerOrder.id) !== paymentReference
      || providerOrder.type !== "online"
      || providerOrder.live_mode === true
      || String(providerOrder.external_reference ?? "") !== String(localOrder.order_id)
      || (providerOrder.currency_id && providerOrder.currency_id !== "BRL")
      || totalCents === null
      || totalCents <= 0
      || totalCents !== Number(localOrder.total_cents)
      || paidCents === null) {
      return out({ error: "provider_order_mismatch", message: "Os dados do pedido não correspondem ao pedido sandbox gravado na loja." }, 409, origin);
    }

    let paymentStatus = "pending";
    if (providerOrder.status === "processed" && paidCents >= totalCents) paymentStatus = "approved";
    else if (providerOrder.status === "cancelled") paymentStatus = "cancelled";
    else if (providerOrder.status === "expired") paymentStatus = "expired";
    else if (providerOrder.status === "rejected") paymentStatus = "rejected";
    // Keep a locally approved payment approved if an older provider snapshot arrives later.
    if (localOrder.payment_status === "approved" && paymentStatus !== "approved") paymentStatus = "approved";

    const eventId = ["manual-sync", paymentReference, paymentStatus, totalCents, paidCents, String(providerOrder.version ?? "")].join(":");
    const saveResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/apply_store_sandbox_payment_event`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        p_event_id: eventId,
        p_order_id: localOrder.order_id,
        p_payment_reference: paymentReference,
        p_provider_total_cents: totalCents,
        p_payment_status: paymentStatus,
      }),
    });
    if (!saveResponse.ok) throw new Error("sandbox_payment_persistence_failed");
    console.info(JSON.stringify({
      event: "sandbox_manual_sync_completed",
      reference_prefix: paymentReference.slice(0, 8),
      payment_status: paymentStatus,
      total_cents: totalCents,
      paid_cents: paidCents,
    }));
    return out({ ok: true, payment_status: paymentStatus }, 200, origin);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    const status = reason === "admin_auth_required" ? 401 : reason === "admin_access_required" ? 403 : 500;
    console.error(JSON.stringify({ event: "sandbox_manual_sync_failed", reason }));
    return out({ error: reason, message: status === 401 ? "Entre novamente no painel." : status === 403 ? "Sua conta não tem acesso administrativo ativo." : "Não foi possível sincronizar o pedido agora." }, status, origin);
  }
});
