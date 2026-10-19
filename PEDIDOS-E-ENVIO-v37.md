# Pedidos e expedição — v37

## O que aparece em Pedidos

- Nome e identificação do pedido, data, cliente e ambiente de produção ou teste.
- Cada linha mostra nome do produto, SKU, opções/variante, quantidade, valor unitário e total da linha. Na tela desktop, grupos com vários produtos podem ser expandidos; no celular os itens ficam visíveis em sequência.
- Pagamento, etapa de expedição, rastreio, destinatário e endereço de entrega.

## Aba Expedição

- A fila contém apenas pedidos com pagamento aprovado, incluindo pedidos de teste identificados como teste.
- Os filtros mostram **Aguardando envio**, **Enviados**, **Entregues** e **Todos pagos**.
- Em **Gerenciar envio**, o admin pode salvar: aguardando envio, frete definido, etiqueta criada, enviado ou entregue, e um código de rastreio de até 120 caracteres.
- O status e o rastreio são gravados no Supabase. A função usa sessão autenticada, perfil admin ativo e RLS; não permite alterar pedidos não pagos.
- A integração de compra da etiqueta e obtenção automática de rastreio do Melhor Envio ainda não está ligada a este fluxo.

## Sincronização de pagamento

A aba **Pedidos** consulta pedidos sandbox pendentes ao abrir e a cada 30 segundos enquanto estiver visível. O botão **Atualizar pagamento no MP** permanece para consulta manual. Pedidos de produção são atualizados pelo webhook validado do Mercado Pago.

## Backend aplicado

No projeto `msofalaizuztqtoukxgf`, a migração `order_fulfillment_management` adiciona etapa e rastreio aos pedidos de teste e publica RPCs autenticadas para listagem e atualização. As tabelas de pedidos seguem protegidas por RLS.

Funções ativas: `checkout-create-sandbox` v23, `shipping-quote` v37 e `mercadopago-sync-sandbox-order` v8. CORS da prévia local: `localhost` e `127.0.0.1`, portas `4280`–`4283`. A sincronização de pagamento mantém `verify_jwt=true`.

## Abrir o preview

1. Extraia o ZIP para `Downloads\Fio-de-Varanda-front-v37`.
2. Abra PowerShell nessa pasta e rode `./INICIAR-PREVIEW.ps1`.
3. Entre no painel e abra **Pedidos** ou **Expedição**.
