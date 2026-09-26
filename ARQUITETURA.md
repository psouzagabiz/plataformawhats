# Paroquiano — estado da reconstrução e roteiro

## Por que este arquivo existe

Em 2026-09-25 à noite, alterações foram feitas no projeto via Claude Code em outra
máquina, mas nunca foram publicadas (`vercel deploy`/`vercel --prod`) — o último deploy
real ficou registrado às 2026-09-25 10:18 (horário de Brasília). Como o projeto não tinha
Git conectado, essas alterações não existem em nenhum lugar recuperável. Este repositório
foi criado em 2026-09-26 para que isso não aconteça de novo: a partir de agora, todo
código deve ser commitado e a Vercel deve fazer deploy automático a partir do Git, nunca
mais via `vercel deploy` manual sem commit.

**Pegadinha descoberta em 2026-09-26 (guardar para o futuro)**: depois de um rollback
manual (`vercel rollback` ou `request_rollback`), a Vercel **trava o domínio de produção**
nesse deployment antigo — pushes seguintes para `main` continuam buildando e aparecem como
`state: READY, target: production` nas listagens, mas o domínio real (`paroquiano-painel.vercel.app`)
não é atualizado sozinho. É preciso promover manualmente o deployment novo:
`vercel promote <url-do-deployment>`. Depois de qualquer rollback, sempre confirmar com
`vercel inspect paroquiano-painel.vercel.app` (olhar o campo `id`/`created`) que o domínio
está mesmo no deployment esperado antes de considerar um push "publicado" — não confiar só
no `state`/`target` do `list_deployments`.

## Estado da reconstrução do código existente

O código publicado em produção (`paroquiano-painel.vercel.app`) foi parcialmente
recuperado, lendo o deployment ao vivo (a API de leitura de arquivos de deployment da
Vercel corta arquivos grandes em ~1.2KB, sem paginação — não dá pra puxar mais que isso
por chamada):

**Completos** (lidos direto do servidor estático, sem corte):
`public/app.js`, `public/ui.js`, `public/painel.js`, `public/agenda.js`, `public/teste.js`,
`public/estilo.css`, `public/agenda.css`, `public/index.html` (reconstruído via DOM ao
vivo — ver nota no topo do próprio arquivo), `api/rotina.js` (~99% completo),
`lib/seguranca.js`, `vercel.json`, `package.json`.

**Incompletos** (cortados pela API da Vercel — têm nota `NOTA DE RECONSTRUÇÃO` no topo,
**não fazer deploy como estão**):
`lib/banco.js`, `api/principal.js`.

**Nunca lidos** (existem em produção, mas esta sessão não chegou a buscá-los — stubs
apenas para não deixar buracos silenciosos):
`lib/agenda.js`, `lib/confirmacao.js`, `lib/rotasAgenda.js`, `lib/teste.js`.

**Nota sobre a estrutura de pastas**: o deployment original (visto via
`list_deployment_files`) mostrava tudo aninhado sob uma pasta `src/`. O projeto na Vercel
tem "Root Directory" vazio (raiz do repo) — confirmado no painel — então o zero-config só
reconhece `api/*.js` e `lib/*.js` na raiz do repositório, não sob `src/`. Um primeiro push
com tudo sob `src/` falhou o build ("The pattern api/principal.js... doesn't match any
Serverless Functions"); a estrutura foi corrigida para `api/`, `lib/` e `public/` direto na
raiz do repo (mantendo os imports relativos entre `api/` e `lib/` intactos, já que
continuam sendo pastas irmãs).

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

## Status em 2026-09-26: backend reconstruído e em produção

`api/principal.js` e todos os `lib/*.js` foram reescritos (branch `reconstrucao-backend`,
testados num deploy de preview e validados manualmente por Gabriela — painel, atendimentos
com histórico real de conversa e agenda todos conferidos — antes de mesclar em `main` e ir
para produção). Scripts de validação somente-leitura ficam em `scripts/testar-esquema.mjs`
e `scripts/testar-consultas.mjs`.

**Pontos ainda não verificados de verdade** (reconstrução de boa-fé, sem o código original
para comparar — ver avisos no topo de `lib/confirmacao.js`, `lib/agenda.js`, `lib/teste.js`):
- O cálculo exato de prazo de confirmação (`calcularPrazo` em `lib/agenda.js`).
- O ciclo completo de confirmação por WhatsApp (`lib/confirmacao.js`): só foi testado que as
  consultas rodam sem erro, **não** que uma confirmação de verdade funciona de ponta a ponta
  com o robô.
- Como o robô (processo local de WhatsApp, fora deste repositório) efetivamente fala com a
  API — não há rota de webhook reconstruída para ele reportar entregas
  (`registrarEntrega`) ou respostas (`processarResposta`); essas funções existem em
  `lib/confirmacao.js` mas nada em `api/principal.js` as chama ainda. Precisa investigar
  como o robô se conecta (provavelmente precisa do código-fonte dele, que não está aqui).

## Status em 2026-09-26: plataforma multi-instituição implementada (Fase 2)

Feito na branch `multi-instituicao`, testado num deploy de preview antes de ir pra `main`:

- **Schema**: colunas novas em `paroquia` (`tipo`, `status`, `contato_nome`,
  `contato_email`), `papel` em `atendente` (`atendente` | `admin` | `super_admin`), e
  `paroquia_id` em `conversa`, `mensagem`, `comprovante`, `conteudo`, `pronta`, `saida` —
  tudo aditivo (`add column if not exists`). Tabela nova `tentativa_cadastro` para limitar
  abuso do cadastro self-service. Backfill (`scripts/migrar-multi-instituicao.mjs`) rodado
  contra produção com aprovação da usuária: 134 linhas antigas (conversas, mensagens,
  comprovantes, mensagem pronta, fila de saída, textos do robô) marcadas com
  `paroquia_id = 1` (Paróquia Sant'Ana, a instituição já existente). Conferido sem órfãos
  depois.
- **Login com seletor de instituição**: busca por nome antes de escolher o atendente
  (`GET /api/instituicoes?busca=`), instituição lembrada no navegador para próximos logins.
- **Cadastro self-service**: `POST /api/instituicoes` — cria a instituição + primeiro
  atendente (`papel = 'admin'`) e já loga. Limitado a 3 cadastros/hora por IP
  (`tentativa_cadastro`).
- **Painel matriz**: `papel = 'super_admin'` vê um item de menu novo listando todas as
  instituições (atendentes, conversas ativas, situação) com suspender/reativar
  (`/api/matriz/instituicoes*`). Instituição suspensa bloqueia login
  (`api/principal.js`, rotas `entrar` e `atendenteLogado`).
- **Testado de ponta a ponta no preview** (não só leitura): login da Paróquia Sant'Ana
  continua igual; criada uma instituição de teste pelo cadastro self-service e confirmado
  que o painel dela aparece **totalmente vazio** (isolamento real, não só teórico); painel
  matriz testado listando as duas instituições com as contagens certas; instituição de
  teste removida do banco depois (`scripts/limpar-teste.mjs`, já apagado do repo — era só
  para teste manual).
- **Ainda não feito** (registrado, não escondido): dar acesso/suporte direto de dentro do
  painel matriz para uma instituição específica (precisa de log de auditoria — ver Fase 2
  original abaixo); marca visual segue compartilhada entre instituições (proposital, ver
  decisão original); a Gabriela **ainda não foi marcada como `super_admin`** — isso fica
  pra ser feito manualmente com ela ciente, não em massa.
- **Limitação conhecida, não resolvida agora**: `conversa` e `mensagem` continuam
  chaveadas só por `telefone` (chave primária não mudou, para não mexer numa PK já usada em
  produção). Se a mesma pessoa (mesmo WhatsApp) escrever para duas instituições diferentes,
  colidiria numa única linha. Corrigir isso de verdade exige mudar a chave primária dessas
  duas tabelas para `(paroquia_id, telefone)` — não feito nesta etapa.

<!-- deploy automatico via Git conectado em 2026-09-26 -->
