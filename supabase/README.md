# Supabase — Fio de Varanda v37

Projeto `msofalaizuztqtoukxgf`. Credenciais privadas permanecem em Edge Function secrets; nenhuma chave de serviço ou token é distribuído no ZIP.

## Pedidos e expedição

- Pedidos de produção usam `public.orders` e `public.order_items`. Os itens preservam nome, SKU, opções, preço unitário, quantidade e total da linha como snapshots feitos no checkout.
- Pedidos sandbox guardam linhas itemizadas em `private.store_sandbox_orders.items`. A consulta administrativa exige perfil ativo.
- Migração aplicada: `20261019003239_order_fulfillment_management.sql`. Adiciona `shipping_status` e `tracking_code` aos pedidos sandbox, uma função admin para ler pedidos detalhados e uma função para salvar o status/rastreio de pedidos pagos.
- O RPC `admin_update_store_order_fulfillment` é `SECURITY INVOKER`, exige perfil admin ativo e grava somente status de envio e rastreio. RLS protege os pedidos; não permite atualizar pedido sem pagamento aprovado.
- A compra da etiqueta do Melhor Envio e o rastreio automático ainda não estão ligados.

## Pagamento

Pedidos comerciais são confirmados pelo webhook de produção do Mercado Pago. A aba Pedidos sincroniza pagamentos sandbox pendentes enquanto estiver aberta e mantém a ação manual. A Edge Function `mercadopago-sync-sandbox-order` segue com `verify_jwt=true`.

## Funções ativas e prévia

- `checkout-create-sandbox`: v23.
- `shipping-quote`: v37.
- `mercadopago-sync-sandbox-order`: v8.
- CORS para a prévia local em `localhost`/`127.0.0.1`: portas 4280–4283.
