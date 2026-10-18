# Backend Supabase — Fio de Varanda v21

Projeto Supabase: `msofalaizuztqtoukxgf`. As migrações de base, índices, catálogo, checkout/pagamentos e autorização OAuth do Melhor Envio já foram aplicadas. As cinco Edge Functions também estão publicadas. Os tokens privados ficam no backend; o checkout permanece desativado até a configuração operacional ser concluída.

## Funções publicadas

- `shipping-quote`: autentica a chamada pela origem permitida e chave pública, exige dados físicos reais e gera cotação assinada com validade curta.
- `checkout-create`: valida cotação e carrinho, recalcula valores e reserva estoque no banco antes de criar a cobrança pelo Mercado Pago.
- `mercadopago-webhook`: valida assinatura e consulta a ordem no provedor antes de confirmar pagamento e estoque.
- `melhor-envio-oauth-start`: exige sessão Supabase e perfil administrativo ativo antes de iniciar a autorização OAuth.
- `melhor-envio-oauth-callback`: valida o estado assinado da autorização e armazena tokens em tabela no esquema privado.

As RPCs de pedido, pagamento e token permitem execução somente ao `service_role`; anon e authenticated não podem executar. A tabela privada de tokens não concede leitura a anon nem authenticated. O webhook não considera um retorno do navegador como confirmação de pagamento.

## Segredos de produção

Configure em **Supabase → Edge Functions → Secrets**. Nunca os coloque no JavaScript do navegador, no repositório ou no ZIP. A relação e a ordem de configuração estão no `README.md` da raiz.

Mantenha `CHECKOUT_ENABLED=false` enquanto preços, estoque, CEP, domínio HTTPS, callback OAuth e webhook não forem verificados. Ativar produção permite cobranças reais.

## Pendências antes de vender

- Credenciais de produção ainda não cadastradas, e nenhuma transação foi enviada.
- O domínio próprio ainda precisa ser registrado/configurado com HTTPS e listado nas origens CORS.
- CEP de origem, peso e dimensões embaladas dos produtos precisam ser confirmados. A auditoria atual encontrou 0 de 98 variantes com medidas válidas.
- Os preços, fotos, quantidades de estoque e produtos ainda são demonstrativos; confirme direitos das fotos e dados comerciais.
- A loja cota o frete e inclui o valor escolhido no checkout. Compra/emissão de etiqueta, rastreamento do pedido e documentos fiscais não foram implementados nesta etapa.
- Ative no Supabase Auth a proteção contra senhas vazadas (aviso do Security Advisor).

O Performance Advisor também lista índices ainda sem uso e políticas permissivas sobrepostas no catálogo/admin. Os avisos são informativos no estágio atual; avalie métricas de produção antes de remover índices ou alterar políticas.
