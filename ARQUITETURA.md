# Paroquiano — estado da reconstrução e roteiro

## Por que este arquivo existe

Em 2026-09-25 à noite, alterações foram feitas no projeto via Claude Code em outra
máquina, mas nunca foram publicadas (`vercel deploy`/`vercel --prod`) — o último deploy
real ficou registrado às 2026-09-25 10:18 (horário de Brasília). Como o projeto não tinha
Git conectado, essas alterações não existem em nenhum lugar recuperável. Este repositório
foi criado em 2026-09-26 para que isso não aconteça de novo: a partir de agora, todo
código deve ser commitado e a Vercel deve fazer deploy automático a partir do Git, nunca
mais via `vercel deploy` manual sem commit.

## Estado da reconstrução do código existente

O código publicado em produção (`paroquiano-painel.vercel.app`) foi parcialmente
recuperado, lendo o deployment ao vivo (a API de leitura de arquivos de deployment da
Vercel corta arquivos grandes em ~1.2KB, sem paginação — não dá pra puxar mais que isso
por chamada):

**Completos** (lidos direto do servidor estático, sem corte):
`public/app.js`, `public/ui.js`, `public/painel.js`, `public/agenda.js`, `public/teste.js`,
`public/estilo.css`, `public/agenda.css`, `public/index.html` (reconstruído via DOM ao
vivo — ver nota no topo do próprio arquivo), `src/api/rotina.js` (~99% completo),
`src/lib/seguranca.js`, `vercel.json`, `package.json`.

**Incompletos** (cortados pela API da Vercel — têm nota `NOTA DE RECONSTRUÇÃO` no topo,
**não fazer deploy como estão**):
`src/lib/banco.js`, `src/api/principal.js`.

**Nunca lidos** (existem em produção, mas esta sessão não chegou a buscá-los — stubs
apenas para não deixar buracos silenciosos):
`src/lib/agenda.js`, `src/lib/confirmacao.js`, `src/lib/rotasAgenda.js`, `src/lib/teste.js`.

O bug relatado pela usuária (Gabriela) — no login, o espaço onde deveriam aparecer os
atendentes (Gabriela/Jucilda/Tiago) ficava abaixo de três blocos de carregamento vazios —
foi corrigido em `public/app.js`, função `mostrarLogin()`: adicionado
`caixa.replaceChildren()` antes de inserir a lista real de atendentes (o HTML já vinha
com 3 `<div class="esqueleto linha-alta">` fixos, e o código só dava `append`, nunca
limpava).

## Banco de dados

O Postgres é hospedado no Supabase, conectado à Vercel via `POSTGRES_URL`/`DATABASE_URL`.
**Já tem dados reais de produção** (conversas, agenda, comprovantes). Antes de escrever
qualquer migração, rode `scripts/introspeccao-schema.mjs` (somente leitura, usa
`information_schema.columns` — nunca faz `create`/`alter`) com
`vercel env pull .env.local && node --env-file=.env.local scripts/introspeccao-schema.mjs`.

### Descoberta importante (2026-09-26): a migração multi-instituição já começou no banco

O schema real **já tem** uma tabela `paroquia` (id, nome, cidade, fuso,
antecedencia_confirmacao_min, horario_envio_confirmacao) e coluna `paroquia_id` em:
`atendente`, `compromisso`, `compromisso_historico`, `dia_fechado`, `expediente`, `padre`,
`teste_confirmacao`. Isso é quase certamente parte do trabalho feito na sessão de
2026-09-25 à noite que motivou este resgate: mudanças de banco de dados são permanentes
(rodam direto no Postgres), diferente de deploys de código (que nunca chegaram a ser
publicados) — então essa parte sobreviveu.

**Porém a migração ficou pela metade**: as tabelas de conversas e atendimento —
`conversa`, `mensagem`, `comprovante`, `conteudo` (textos do robô, linha única id=1),
`pronta`, `midia`, `saida`, `resposta_recebida`, `presenca`, `webhook_recebido` —
**ainda não têm `paroquia_id`**. O código atual (`principal.js`, `banco.js`) também não
foi recuperado o suficiente para confirmar se já lê/grava essas colunas novas ou não.

Isso muda a Fase 2 do roteiro abaixo: não é "criar do zero", é **terminar** uma migração
já em andamento — adicionar `paroquia_id` (nullable, depois backfill com a paróquia atual,
depois not null) nas tabelas que faltam, e então atualizar o código do servidor para
filtrar tudo por `paroquia_id` da sessão.

Schema completo das 21 tabelas capturado em 2026-09-26 — rodar o script de novo antes de
qualquer migração para confirmar que nada mudou desde então.

## Roteiro: transformar em plataforma multi-instituição

Decisão da usuária (Gabriela, administradora): a plataforma vai deixar de ser exclusiva
desta paróquia e passar a atender outras paróquias e escolas católicas, com:

1. **Login único com seletor de instituição** (não subdomínio por instituição) — a tela
   de login ganha um passo de busca/seleção da instituição antes da lista de atendentes.
2. **Cadastro self-service** — outras instituições se cadastram sozinhas, sem aprovação
   manual (precisa de rate limiting por IP contra abuso, reaproveitando o mecanismo já
   existente em `seguranca.js`).
3. **Painel matriz** — papel novo `super_admin` (só a Gabriela), tela separada listando
   todas as instituições, com acesso de suporte a cada uma (com log de auditoria).

Passos técnicos, nesta ordem:
- Tabela `instituicao` (id, nome, tipo: paróquia/escola/outro, status, criada_em).
- `instituicao_id` em todas as tabelas hoje globais (`atendente` e as demais reveladas
  pela introspecção do schema real). Migração aditiva: coluna nullable → backfill dos
  dados atuais como a primeira instituição → `not null`. Toda query do servidor passa a
  filtrar por `instituicao_id` vindo da **sessão**, nunca de input do cliente.
- `/api/atendentes` passa a receber a instituição escolhida.
- Rota pública de cadastro: cria `instituicao` + primeiro atendente (papel "admin" dentro
  da instituição) e já loga.
- `src/api/rotina.js` e o "robô" (conector local de WhatsApp por paróquia) passam a operar
  por instituição (token próprio por instituição).
- Textos do robô (`SECOES_TEXTOS` em `public/app.js`) ganham `instituicao_id`. Marca
  visual (`estilo.css`) fica compartilhada (identidade "Paroquiano"), sem retema por
  instituição — a revisitar se pedirem marca própria depois.

Este roteiro ainda não foi implementado — é a próxima etapa, a ser detalhada de verdade
assim que o schema real do banco estiver em mãos.

<!-- deploy automatico via Git conectado em 2026-09-26 -->
