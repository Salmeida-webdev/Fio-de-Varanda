# Fio de Varanda · Front-end v37

A versão 37 detalha os itens de cada pedido e acrescenta a aba **Expedição** para acompanhar pedidos pagos, registrar a etapa de envio e salvar o código de rastreio. A aba **Pedidos** mantém a sincronização automática de pagamentos sandbox e o botão manual.

O preview local escolhe uma porta livre entre `4280` e `4283`. O script `INICIAR-PREVIEW.ps1` abre a loja e informa também o endereço do painel. Nenhuma credencial privada está no pacote.

## Expedição e pedidos

- Produtos, SKU, variantes, quantidade, preço unitário e total por linha aparecem nos pedidos.
- A nova aba **Expedição** separa a fila em **Aguardando envio**, **Enviados**, **Entregues** e **Todos pagos**.
- O administrador registra status e código de rastreio; a etapa só pode ser atualizada depois da aprovação do pagamento.
- A compra automática da etiqueta do Melhor Envio não faz parte desta etapa.

## Backend

A migração `20261019003239_order_fulfillment_management.sql` foi aplicada no Supabase. As funções sandbox e de cotação aceitam CORS nas portas `4280` a `4283`. Veja `PEDIDOS-E-ENVIO-v37.md` e `supabase/README.md`.
