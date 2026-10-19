# Diagnóstico e correção — Fio de Varanda v28

## Causa confirmada

- Em 18/10/2026, a página usada no teste estava em `fiodevaranda.netlify.app`, não na prévia local.
- O Supabase registrou três chamadas para `shipping-quote` com HTTP 400. O corpo tinha CEP válido e `items: []`; portanto, a API recusou a cotação antes de consultar o Melhor Envio.
- O catálogo tem 50 produtos e 98 variantes. A checagem encontrou zero variantes ativas sem peso/dimensões e zero produtos ativos sem variante.
- A versão v27 já bloqueava a chamada sem produto vinculado; a página pública mostrada na captura está servindo um frontend anterior ao código do pacote.

## Correção da v28

- Recupera produtos antigos de carrinho por ID, slug, SKU ou nome quando houver dados correspondentes.
- Persiste `productSlug`, `productName` e `variantSku` nos itens novos e normalizados.
- Valida que cada item mapeie para uma variante UUID ativa e quantidade inteira antes de enviar cotação ou checkout; não envia listas vazias.
- Atualiza o cache do script e isola a prévia na porta `4244`.
- Inclui a porta `4244` na allowlist CORS das funções `shipping-quote` e `checkout-create-sandbox`.

## Limites

A versão v28 ainda precisa ser testada localmente. O site público não foi publicado nem atualizado nesta etapa. Os pesos e dimensões do catálogo permanecem dados de demonstração estimados.
