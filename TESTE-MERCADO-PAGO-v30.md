# Validação Mercado Pago — v30

1. Em Mercado Pago Developers, no app Fio de Varanda, deixe configurado o endpoint sandbox e o evento **Order (Mercado Pago)**.
2. A chave secreta desse app deve corresponder ao segredo `MERCADO_PAGO_TEST_WEBHOOK_SECRET` no Supabase; não redefina sem atualizar o segredo.
3. Na simulação, informe como Data ID `ORDTST01M589J33172S9E2F25EWKEHMP`.
4. Confira nos logs da Edge Function `mercadopago-webhook-sandbox` o evento `sandbox_order_reconciled` e depois confira `private.store_sandbox_orders.payment_status`.
5. O valor aprovado só deve ser aceito se a API retornar Order de teste `online`, `live_mode=false`, status `processed` e total pago igual ou superior ao total da loja.

O POST 200 sozinho prova apenas que o webhook recebeu a simulação; a confirmação é o estado canônico no Supabase.
