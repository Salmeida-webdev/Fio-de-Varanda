# Fio de Varanda — versão 21

Loja responsiva de cama, mesa, banho e redes com catálogo no Supabase, painel autenticado e checkout preparado para integração de produção com Mercado Pago e Melhor Envio. As credenciais nunca ficam no navegador nem neste pacote.

## Prévia no Windows

Extraia a pasta do ZIP e rode no PowerShell:

```powershell
$Projeto = "$env:USERPROFILE\Downloads\Fio-de-Varanda-front-v21"
Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\Fio-de-Varanda-frontend-v21.zip" -DestinationPath $Projeto -Force
Set-Location $Projeto
.\INICIAR-PREVIEW.ps1
```

A loja abre em `http://localhost:4200`; o painel fica em `/admin.html`. O checkout está fechado por padrão. A prévia local não usa credenciais de produção.

## O que está conectado

- O painel lê produtos e estoque do Supabase e agora edita também peso e dimensões do produto embalado.
- Os pedidos reais gravam snapshots de preço/frete e reservam estoque em transação no PostgreSQL.
- O Mercado Pago cria a order server-side; um webhook valida a assinatura, consulta a order no provedor e só então confirma o pagamento/baixa o estoque.
- A cotação do Melhor Envio usa os pesos e dimensões cadastrados; o valor da opção assinada entra no total do checkout.
- O Melhor Envio usa OAuth de produção iniciado pela aba Configurações; tokens ficam no backend e são renovados automaticamente.
- A aba Pedidos agora lê registros do backend.
- As funções Supabase publicadas são `shipping-quote`, `checkout-create`, `mercadopago-webhook`, `melhor-envio-oauth-start` e `melhor-envio-oauth-callback`.

## Configuração de produção pendente

As Edge Functions e migrações estão publicadas no projeto Supabase. O checkout permanece bloqueado até cadastrar segredos e confirmar dados comerciais reais. No Supabase, abra **Edge Functions → Secrets** e preencha:

| Segredo | Valor |
|---|---|
| `STORE_PUBLISHABLE_KEY` | Chave pública atual do projeto Supabase |
| `CHECKOUT_SIGNING_SECRET` | Segredo aleatório forte com pelo menos 32 bytes; use uma senha aleatória gerada, não uma senha pessoal |
| `CHECKOUT_ENABLED` | Deixe `false` até concluir configuração e validações; depois, `true` habilita cobrança real |
| `MERCADO_PAGO_MODE` | `production` |
| `MERCADO_PAGO_ACCESS_TOKEN` | Token privado de produção (`APP_USR-...`) do Mercado Pago |
| `MERCADO_PAGO_WEBHOOK_SECRET` | Assinatura secreta gerada na configuração de Webhooks do Mercado Pago |
| `MELHOR_ENVIO_MODE` | `production` |
| `MELHOR_ENVIO_CLIENT_ID` | ID do app de produção do Melhor Envio |
| `MELHOR_ENVIO_CLIENT_SECRET` | Segredo privado do app de produção do Melhor Envio |
| `MELHOR_ENVIO_REDIRECT_URI` | `https://msofalaizuztqtoukxgf.supabase.co/functions/v1/melhor-envio-oauth-callback` |
| `MELHOR_ENVIO_API_BASE` | `https://www.melhorenvio.com.br/api/v2` |
| `STORE_ORIGIN_POSTAL_CODE` | CEP de origem da loja, com 8 dígitos |
| `SITE_URL` | URL HTTPS final do domínio da loja, sem barra no final |
| `CORS_ALLOWED_ORIGINS` | Domínio HTTPS final; durante prévia, inclua também `http://localhost:4200,http://127.0.0.1:4200` |

### Mercado Pago

1. Em **Suas integrações**, use a credencial privada de produção.
2. Em **Webhooks**, configure `https://msofalaizuztqtoukxgf.supabase.co/functions/v1/mercadopago-webhook` e selecione o evento **Order (Mercado Pago)**.
3. Salve a assinatura gerada como `MERCADO_PAGO_WEBHOOK_SECRET` no Supabase.
4. Este projeto exige credencial de produção (`APP_USR-...`), então cada pagamento autorizado pode cobrar dinheiro real. Não use cartões ou contas de teste nesse ambiente. Para validar com cartões de teste, crie uma implantação separada com credenciais e endpoint de sandbox. Mantenha `CHECKOUT_ENABLED=false` até conferir credenciais, domínio, catálogo, estoque, frete e webhook; habilitar a variável libera cobranças reais.

### Melhor Envio

1. Crie um app de produção no Melhor Envio e cadastre como callback exatamente a URI indicada na tabela de segredos.
2. Solicite apenas as permissões necessárias à cotação (`shipping-calculate`) e, em uma etapa posterior para etiquetas, as permissões de carrinho, checkout, geração, impressão e rastreio (`cart-read`, `cart-write`, `shipping-checkout`, `shipping-generate`, `shipping-preview`, `shipping-print`, `shipping-tracking`).
3. Depois de preencher `MELHOR_ENVIO_CLIENT_ID`, `MELHOR_ENVIO_CLIENT_SECRET` e `MELHOR_ENVIO_REDIRECT_URI`, entre no painel da loja → **Configurações** → **Conectar Melhor Envio**. Autorize a conta. O callback persiste os tokens fora do frontend e o backend renova o token a cada expiração.

## Dados que ainda faltam para cotar frete com precisão

A consulta ao banco encontrou **0 de 98 variantes** com peso e dimensões. Edite cada produto na aba **Produtos**, preenchendo o peso em gramas e as dimensões embaladas em centímetros. A cotação ficará indisponível para produtos sem medidas válidas. Confirme também preço, estoque, fotos comerciais e CEP de origem; os valores atualmente cadastrados são demonstrativos.

## Domínio e publicação

O domínio `fio-de-varanda.com.br` segue como candidato e ainda não foi verificado/registrado. Configure o domínio e HTTPS no provedor de hospedagem; depois atualize `SITE_URL` e `CORS_ALLOWED_ORIGINS`. O checkout não deve ser ativado com apenas a URL localhost.

## Limites desta entrega

Esta versão calcula o frete e inclui a opção escolhida no pagamento. O checkout de pagamento e a cotação real ainda dependem das credenciais, do domínio e dos dados físicos reais dos produtos. Não emite nem compra a etiqueta automaticamente: isso exigiria dados legais do remetente/destinatário, documentação fiscal e uma ação autorizada que pode debitar a carteira do Melhor Envio. Nenhuma compra foi enviada nesta etapa.

As 50 fotos e produtos existentes são materiais demonstrativos do portfólio; não são fotos/documentos verificados de fornecedores. Substitua imagens, preços, peso, medidas e estoque pelos dados confirmados antes de aceitar pedidos reais.
