// Conexão com o Postgres (Supabase, conectado pela Vercel) e garantia do esquema.
//
// O schema abaixo foi reconstruído a partir de uma introspecção SOMENTE LEITURA do banco
// real de produção em 2026-09-26 (ver scripts/introspeccao-schema.mjs e ARQUITETURA.md).
// Todo "create table if not exists" é seguro de rodar contra o banco real: nunca altera
// uma tabela já existente, só cria o que faltar (útil para um banco de testes novo, local
// ou de outra instituição). As colunas de chave primária/únicas foram inferidas pelo uso
// no código (nome das colunas + como cada tabela é consultada), não confirmadas via
// pg_constraint — checar antes de confiar cegamente em restrições não vistas aqui.
import postgres from 'postgres';
import { hashSenha } from './seguranca.js';

let sql;
export function banco() {
  if (!sql) {
    const bruto = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    if (!bruto) throw new Error('Banco de dados não configurado (POSTGRES_URL ausente)');
    // parâmetros extras da URL do Supabase confundem o driver; o SSL é ligado abaixo
    const url = new URL(bruto);
    url.search = '';
    const local = ['localhost', '127.0.0.1'].includes(url.hostname); // banco de testes
    sql = postgres(url.toString(), {
      ssl: local ? false : 'require',
      prepare: false,       // necessário com o pooler (modo transação)
      max: Number(process.env.PG_MAX || 3),
      idle_timeout: 20,
      connect_timeout: 10,
      types: {
        // Por padrão o driver devolve colunas "date" como objeto Date do JS — mas todo o
        // código (mensagens de confirmação, agenda, painel) espera texto "AAAA-MM-DD" (é o
        // que o Postgres manda no protocolo texto; aqui só evitamos o parse pra Date).
        date: { to: 1082, from: [1082], serialize: (x) => x, parse: (x) => x },
      },
    });
  }
  return sql;
}

// Atendentes iniciais (senha inicial 2607 — cada um pode trocar na plataforma)
const ATENDENTES = [
  { nome: 'Gabriela', setor: 'recepcao' },
  { nome: 'Jucilda', setor: 'documentos' },
  { nome: 'Tiago', setor: 'financeiro' },
];
const SENHA_INICIAL = '2607';

let pronto = null;
export function garantirEsquema() {
  if (!pronto) pronto = criar().catch((e) => { pronto = null; throw e; });
  return pronto;
}

async function criar() {
  const sql = banco();

  await sql.unsafe(`create table if not exists paroquia (
    id serial primary key,
    nome text not null,
    cidade text not null default '',
    fuso text not null default 'America/Sao_Paulo',
    antecedencia_confirmacao_min integer not null default 30,
    horario_envio_confirmacao time not null default '08:00:00',
    tipo text not null default 'paroquia',
    status text not null default 'ativa',
    contato_nome text,
    contato_email text,
    criado_em timestamptz not null default now()
  )`);
  // multi-instituição (2026-09-26): colunas novas em tabela que já existia em produção —
  // "create table if not exists" acima não as adiciona a uma tabela já criada, por isso o
  // "alter ... add column if not exists" explícito abaixo (idempotente, seguro de repetir).
  await sql.unsafe(`alter table paroquia
    add column if not exists tipo text not null default 'paroquia',
    add column if not exists status text not null default 'ativa',
    add column if not exists contato_nome text,
    add column if not exists contato_email text`);

  await sql.unsafe(`create table if not exists atendente (
    id serial primary key,
    nome text unique not null,
    setor text not null,
    senha_hash text not null,
    paroquia_id integer references paroquia(id),
    papel text not null default 'atendente'
  )`);
  await sql.unsafe(`alter table atendente add column if not exists papel text not null default 'atendente'`);

  await sql.unsafe(`create table if not exists sessao (
    token_hash text primary key,
    atendente_id integer not null references atendente(id) on delete cascade,
    expira_em timestamptz not null
  )`);

  await sql.unsafe(`create table if not exists tentativa_login (
    id bigserial primary key,
    ip text,
    atendente_id integer references atendente(id) on delete set null,
    criado_em timestamptz not null default now()
  )`);

  await sql.unsafe(`create table if not exists padre (
    id serial primary key,
    paroquia_id integer not null references paroquia(id),
    nome text not null,
    whatsapp text not null default '',
    ativo boolean not null default true,
    criado_em timestamptz not null default now()
  )`);
  // Agenda diária automática ao padre (lib/agendaPadre.js) — guarda idempotência por dia,
  // igual a regra_automatica.ultima_execucao_em.
  await sql.unsafe(`alter table padre add column if not exists ultima_agenda_enviada_em date`);

  await sql.unsafe(`create table if not exists expediente (
    id serial primary key,
    paroquia_id integer not null references paroquia(id),
    dia_semana smallint not null,
    inicio time not null,
    fim time not null
  )`);

  await sql.unsafe(`create table if not exists dia_fechado (
    id serial primary key,
    paroquia_id integer not null references paroquia(id),
    data date not null,
    motivo text not null default ''
  )`);

  await sql.unsafe(`create table if not exists compromisso (
    id bigserial primary key,
    paroquia_id integer not null references paroquia(id),
    tipo text not null,
    padre_id integer references padre(id),
    data date not null,
    hora time not null,
    pessoa_nome text not null default '',
    pessoa_whatsapp text not null default '',
    local text not null default '',
    endereco text not null default '',
    observacoes text not null default '',
    exige_confirmacao boolean not null default true,
    status text not null default 'agendado',
    criado_por text,
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now(),
    prazo_confirmacao timestamptz,
    inicio_envio timestamptz,
    envio_reservado_em timestamptz,
    confirmacao_enviada_em timestamptz,
    confirmacao_msg_id text,
    tentativas_envio integer not null default 0,
    ultimo_erro text,
    respondido_em timestamptz,
    canal_resposta text,
    desmarcado_em timestamptz,
    confirmacao_saida_id bigint
  )`);
  // lib/confirmacao.js (executarRotina, chamada todo minuto por api/rotina.js) varre
  // compromisso filtrando por status + um desses prazos — sem índice, cada execução fazia
  // um scan completo da tabela. A segunda também acelera processarResposta (status =
  // 'aguardando_confirmacao', ordenado por prazo_confirmacao).
  await sql.unsafe(`create index if not exists compromisso_agendado_idx on compromisso (status, inicio_envio)`);
  await sql.unsafe(`create index if not exists compromisso_aguardando_idx on compromisso (status, prazo_confirmacao)`);

  await sql.unsafe(`create table if not exists compromisso_historico (
    id bigserial primary key,
    paroquia_id integer not null references paroquia(id),
    compromisso_id bigint not null references compromisso(id) on delete cascade,
    acao text not null,
    detalhe text not null default '',
    feito_por text not null default '',
    criado_em timestamptz not null default now()
  )`);

  await sql.unsafe(`create table if not exists teste_confirmacao (
    id bigserial primary key,
    paroquia_id integer not null references paroquia(id),
    numero text not null,
    criado_por text not null default '',
    criado_em timestamptz not null default now(),
    enviado_em timestamptz,
    msg_id text,
    erro text,
    resposta text,
    respondido_em timestamptz
  )`);

  await sql.unsafe(`create table if not exists rotina_execucao (
    id bigserial primary key,
    origem text not null default '',
    iniciado_em timestamptz not null default now(),
    terminado_em timestamptz,
    enviados integer not null default 0,
    desmarcados integer not null default 0,
    erros integer not null default 0,
    detalhe text not null default ''
  )`);

  await sql.unsafe(`create table if not exists conversa (
    telefone text primary key,
    nome text not null default '',
    estado text,
    setor text,
    atualizado_em timestamptz not null default now(),
    paroquia_id integer references paroquia(id)
  )`);
  await sql.unsafe(`alter table conversa add column if not exists paroquia_id integer references paroquia(id)`);
  // motor de conversa do robô (lib/robo-conversa.js): em que etapa do menu a pessoa está,
  // e quantas respostas inválidas seguidas deu nessa etapa (3 = transfere pra humano).
  await sql.unsafe(`alter table conversa add column if not exists etapa text`);
  await sql.unsafe(`alter table conversa add column if not exists tentativas_invalidas integer not null default 0`);

  // Corrige a colisão entre instituições: "conversa" era identificada só por "telefone" —
  // se a mesma pessoa (mesmo WhatsApp) escrevesse para duas instituições diferentes, as
  // duas conversas colidiriam numa única linha (ver nota no topo de api/principal.js e
  // ARQUITETURA.md). Confirmado em produção (scripts/verificar-orfaos.mjs, 2026-10-08) que
  // toda linha já tem paroquia_id preenchido, então é seguro travar como not null e trocar
  // a chave primária para (paroquia_id, telefone). Feito num DO block (idempotente: só age
  // se a PK atual ainda tiver 1 coluna) em vez de "add column if not exists" porque trocar
  // uma primary key não tem sintaxe "if not exists" — sem essa guarda, rodaria (e falharia)
  // de novo em todo cold start.
  await sql.unsafe(`alter table conversa alter column paroquia_id set not null`);
  await sql.unsafe(`
    do $$
    declare
      colunas_na_pk int;
      nome_da_pk text;
    begin
      select count(*), min(c.conname) into colunas_na_pk, nome_da_pk
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.conrelid = 'conversa'::regclass and c.contype = 'p';

      if colunas_na_pk = 1 then
        execute 'alter table conversa drop constraint ' || nome_da_pk;
        alter table conversa add primary key (paroquia_id, telefone);
      end if;
    end $$;
  `);
  // a PK composta acima já serve (paroquia_id) como coluna mais à esquerda — o índice
  // separado que existia antes (conversa_paroquia_idx, da Etapa 1 de performance) ficou
  // redundante.
  await sql.unsafe(`drop index if exists conversa_paroquia_idx`);

  await sql.unsafe(`create table if not exists midia (
    id bigserial primary key,
    tipo text not null,
    nome text,
    dados bytea not null,
    criado_em timestamptz not null default now()
  )`);

  await sql.unsafe(`create table if not exists mensagem (
    id bigserial primary key,
    origem text,
    telefone text not null,
    remetente text not null,
    autor text,
    texto text not null default '',
    midia_id bigint references midia(id),
    midia_tipo text,
    criado_em timestamptz not null default now(),
    paroquia_id integer references paroquia(id)
  )`);
  await sql.unsafe(`alter table mensagem add column if not exists paroquia_id integer references paroquia(id)`);
  // trava contra duplicidade: o WhatsApp (Baileys) pode entregar o mesmo evento de mensagem
  // mais de uma vez (visto na prática com números "@lid" de múltiplos aparelhos) — sem isso,
  // cada entrega repetida disparava o robô de novo e inundava a pessoa de respostas repetidas.
  // NULL (mensagens do bot/atendente, que não têm id do WhatsApp) continua permitido duplicado.
  await sql.unsafe(`create unique index if not exists mensagem_origem_idx on mensagem (origem) where origem is not null`);
  await sql.unsafe(`create index if not exists mensagem_telefone_idx on mensagem (telefone, id)`);

  await sql.unsafe(`create table if not exists comprovante (
    id bigserial primary key,
    origem text,
    telefone text not null,
    nome text not null default '',
    categoria text not null,
    midia_id bigint references midia(id),
    midia_tipo text,
    valor text,
    data_pagamento text,
    descricao text,
    criado_em timestamptz not null default now(),
    paroquia_id integer references paroquia(id)
  )`);
  await sql.unsafe(`alter table comprovante add column if not exists paroquia_id integer references paroquia(id)`);
  // rota "comprovantes" do painel: filtra por paroquia_id e ordena por criado_em desc.
  await sql.unsafe(`create index if not exists comprovante_paroquia_idx on comprovante (paroquia_id, criado_em desc)`);

  await sql.unsafe(`create table if not exists pronta (
    id serial primary key,
    titulo text not null,
    texto text not null,
    paroquia_id integer references paroquia(id)
  )`);
  await sql.unsafe(`alter table pronta add column if not exists paroquia_id integer references paroquia(id)`);

  // "id" continua sendo a chave primária (não mexe numa tabela já existente em produção);
  // paroquia_id vira único, então cada instituição tem no máximo uma linha de textos.
  await sql.unsafe(`create table if not exists conteudo (
    id integer primary key default 1,
    versao integer not null,
    textos jsonb not null,
    atualizado_em timestamptz not null default now(),
    atualizado_por text,
    paroquia_id integer unique references paroquia(id)
  )`);
  await sql.unsafe(`alter table conteudo add column if not exists paroquia_id integer references paroquia(id)`);
  await sql.unsafe(`create unique index if not exists conteudo_paroquia_idx on conteudo (paroquia_id)`);

  // fila de saída para o robô (conector local de WhatsApp) consumir
  await sql.unsafe(`create table if not exists saida (
    id bigserial primary key,
    tipo text not null,
    telefone text,
    numero text,
    nome text,
    texto text,
    midia_id bigint references midia(id),
    midia_tipo text,
    nome_arquivo text,
    autor text,
    setor text,
    referencia text,
    valido_ate timestamptz,
    entregue_em timestamptz,
    erro text,
    criado_em timestamptz not null default now(),
    paroquia_id integer references paroquia(id)
  )`);
  await sql.unsafe(`alter table saida add column if not exists paroquia_id integer references paroquia(id)`);
  // robo/index.js faz polling desta consulta a cada poucos segundos (enquanto o robô
  // estiver ligado) — é a consulta mais frequente do sistema e não tinha nenhum índice.
  await sql.unsafe(`create index if not exists saida_pendente_idx on saida (paroquia_id, id) where entregue_em is null and erro is null`);

  // heartbeat do robô: "quem" continua sendo a chave (não mexe na PK de uma tabela já
  // existente em produção) — a convenção passa a ser guardar 'robo:<paroquia_id>' em "quem"
  // em vez de só 'robo', para cada instituição ter seu próprio sinal (ver lib/presenca.js).
  await sql.unsafe(`create table if not exists presenca (
    quem text primary key,
    visto_em timestamptz not null
  )`);

  await sql.unsafe(`create table if not exists tentativa_cadastro (
    id bigserial primary key,
    ip text,
    criado_em timestamptz not null default now()
  )`);

  // dedup de respostas/webhooks recebidos do robô, por id de origem
  await sql.unsafe(`create table if not exists resposta_recebida (
    origem text primary key,
    recebido_em timestamptz not null default now()
  )`);
  await sql.unsafe(`create table if not exists webhook_recebido (
    id text primary key,
    recebido_em timestamptz not null default now()
  )`);

  // conector do robô (robo/), hospedado fora da Vercel: guarda a sessão do Baileys
  // (credenciais + chaves) pra sobreviver a um redeploy sem precisar escanear o QR de novo.
  await sql.unsafe(`create table if not exists whatsapp_sessao (
    paroquia_id integer primary key references paroquia(id),
    dados jsonb not null,
    atualizado_em timestamptz not null default now()
  )`);

  // unificação (2026-09-30): grupos e aniversário do fiel, pendurados em "conversa"
  // (que já é a identidade telefone+paroquia_id) em vez de criar uma tabela nova.
  await sql.unsafe(`alter table conversa add column if not exists grupos text[] not null default '{}'`);
  await sql.unsafe(`alter table conversa add column if not exists aniversario date`);

  await sql.unsafe(`create table if not exists campanha (
    id bigserial primary key,
    paroquia_id integer not null references paroquia(id),
    titulo text not null,
    mensagem text not null,
    grupos text[] not null default '{}',
    destinatarios integer not null default 0,
    criado_por text,
    criado_em timestamptz not null default now()
  )`);
  // rota "campanhas" do painel: filtra por paroquia_id e ordena por criado_em desc.
  await sql.unsafe(`create index if not exists campanha_paroquia_idx on campanha (paroquia_id, criado_em desc)`);

  await sql.unsafe(`create table if not exists regra_automatica (
    id bigserial primary key,
    paroquia_id integer not null references paroquia(id),
    tipo text not null,
    titulo text not null,
    mensagem text not null,
    dia_do_mes smallint,
    ativa boolean not null default true,
    criado_em timestamptz not null default now(),
    ultima_execucao_em timestamptz
  )`);

  await semear(sql);
}

async function semear(sql) {
  const [existe] = await sql`select 1 from atendente limit 1`;
  if (existe) return;
  const [paroquia] = await sql`
    insert into paroquia (nome) values ('Paróquia (padrão)')
    on conflict do nothing
    returning id
  `;
  const paroquiaId = paroquia?.id ?? (await sql`select id from paroquia order by id limit 1`)[0]?.id;
  const senhaHash = await hashSenha(SENHA_INICIAL);
  for (const a of ATENDENTES) {
    await sql`
      insert into atendente (nome, setor, senha_hash, paroquia_id)
      values (${a.nome}, ${a.setor}, ${senhaHash}, ${paroquiaId})
      on conflict (nome) do nothing
    `;
  }
}
