// API da plataforma de atendimento. Todas as rotas /api/* chegam aqui (ver vercel.json).
//
// NOTA DE RECONSTRUÇÃO IMPORTANTE: o roteador original foi perdido quase por completo (a
// API de leitura de arquivos da Vercel cortou o arquivo em ~1.2KB de ~28KB). O que segue é
// uma reconstrução de boa-fé feita lendo o que cada rota precisa devolver a partir do
// código do cliente (public/app.js, public/agenda.js, public/teste.js, que FORAM
// recuperados por completo) e do schema real do banco (ver ARQUITETURA.md). Antes de
// confiar cegamente neste arquivo: revisar a lógica de autenticação/sessão com atenção
// redobrada, e testar cada rota manualmente.
import { banco, garantirEsquema } from '../lib/banco.js';
import {
  hashSenha, conferirSenha, novoToken, hashToken, ipDe, lerCookie,
  bloqueado, registrarFalha, limparFalhas,
} from '../lib/seguranca.js';
import { rotasAgenda } from '../lib/rotasAgenda.js';
import { processarTeste, consultarTeste } from '../lib/teste.js';
import { roboOnline } from '../lib/presenca.js';
import { Erro, Erro400, Erro404 } from '../lib/erros.js';

const DURACAO_SESSAO_DIAS = 7;
const MAX_MIDIA = 3 * 1024 * 1024; // limite de envio da Vercel (~4,5 MB com base64)
const TELEFONE = /^[0-9]{5,20}@(c\.us|lid)$/;

const limpa = (t, max) => String(t ?? '').trim().slice(0, max);
function exigeTelefone(t) {
  if (!TELEFONE.test(String(t))) throw new Erro400('Conversa inválida');
  return t;
}

function corpo(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { throw new Erro400('JSON inválido'); }
  }
  return req.body;
}

/* =================== AUTENTICAÇÃO =================== */
function definirCookieSessao(res, token, { remover = false } = {}) {
  const partes = [
    `sessao=${remover ? '' : token}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax', 'Secure',
    remover ? 'Max-Age=0' : `Max-Age=${DURACAO_SESSAO_DIAS * 24 * 60 * 60}`,
  ];
  res.setHeader('Set-Cookie', partes.join('; '));
}

async function atendenteLogado(req) {
  const token = lerCookie(req, 'sessao');
  if (!token) return null;
  const sql = banco();
  const [linha] = await sql`
    select a.id, a.nome, a.setor, a.paroquia_id as "paroquiaId"
    from sessao s join atendente a on a.id = s.atendente_id
    where s.token_hash = ${hashToken(token)} and s.expira_em > now()
  `;
  return linha || null;
}

function exigeLogin(eu) {
  if (!eu) throw new Erro(401, 'Sessão expirada. Entre novamente.');
  return eu;
}

/* =================== CONVERSAS E MENSAGENS =================== */
async function listarConversas(sql) {
  const linhas = await sql`
    select c.telefone, c.nome, c.estado, c.setor,
      m.texto as ultima_texto, m.midia_id as ultima_midia, m.remetente as ultima_remetente, m.criado_em as ultima_em
    from conversa c
    left join lateral (
      select texto, midia_id, remetente, criado_em from mensagem where telefone = c.telefone order by id desc limit 1
    ) m on true
    order by coalesce(m.criado_em, c.atualizado_em) desc
    limit 500
  `;
  return linhas.map((c) => ({
    telefone: c.telefone, nome: c.nome, estado: c.estado, setor: c.setor,
    ultimaTexto: c.ultima_texto, ultimaMidia: !!c.ultima_midia, ultimaRemetente: c.ultima_remetente, ultimaEm: c.ultima_em,
  }));
}

async function obterMensagens(sql, telefone, depois) {
  const [conversa] = await sql`select telefone, nome, estado, setor from conversa where telefone = ${telefone}`;
  const linhas = await sql`
    select id, remetente, autor, texto, midia_id as "midiaId", midia_tipo as "midiaTipo", criado_em as "criadoEm"
    from mensagem where telefone = ${telefone} and id > ${depois} order by id asc limit 300
  `;
  const [pendente] = await sql`
    select 1 from saida where telefone = ${telefone} and entregue_em is null and erro is null and tipo in ('texto', 'midia')
  `;
  return { conversa: conversa || null, mensagens: linhas, enviando: !!pendente };
}

/* =================== ROTA PRINCIPAL =================== */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const rota = String(req.query.rota || (Array.isArray(req.query.rota) ? req.query.rota.join('/') : '') || '').replace(/^\/+|\/+$/g, '');
  const metodo = req.method;

  try {
    await garantirEsquema();
    const sql = banco();

    // arquivo é servido em binário, não em JSON
    if (rota === 'arquivo' && metodo === 'GET') {
      exigeLogin(await atendenteLogado(req));
      const [m] = await sql`select tipo, dados from midia where id = ${Number(req.query.id)}`;
      if (!m) throw new Erro404('Arquivo não encontrado.');
      res.setHeader('Content-Type', m.tipo || 'application/octet-stream');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.status(200).send(Buffer.from(m.dados));
      return;
    }

    const dados = await rotearJson(req, res, { rota, metodo, sql });
    res.status(200).json(dados ?? {});
  } catch (e) {
    if (e instanceof Erro) { res.status(e.status).json({ erro: e.message }); return; }
    console.error('[principal]', rota, e);
    res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
  }
}

async function rotearJson(req, res, { rota, metodo, sql }) {
  const body = () => corpo(req);
  const query = req.query;

  /* ---------- login (sem sessão) ---------- */
  if (rota === 'atendentes' && metodo === 'GET') {
    return sql`select id, nome, setor from atendente order by id`;
  }

  if (rota === 'entrar' && metodo === 'POST') {
    const { atendenteId, senha } = body();
    const ip = ipDe(req);
    const [a] = await sql`select id, nome, senha_hash from atendente where id = ${Number(atendenteId)}`;
    if (await bloqueado(sql, { ip, atendenteId: a?.id })) {
      throw new Erro(429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
    }
    const ok = a && await conferirSenha(senha, a.senha_hash);
    if (!ok) {
      await registrarFalha(sql, { ip, atendenteId: a?.id });
      throw new Erro(401, 'Nome ou senha incorretos.');
    }
    await limparFalhas(sql, a.id);
    const token = novoToken();
    const expiraEm = new Date(Date.now() + DURACAO_SESSAO_DIAS * 24 * 60 * 60 * 1000);
    await sql`insert into sessao (token_hash, atendente_id, expira_em) values (${hashToken(token)}, ${a.id}, ${expiraEm})`;
    definirCookieSessao(res, token);
    return {};
  }

  /* ---------- daqui pra baixo exige sessão ---------- */
  const eu = await atendenteLogado(req);

  if (rota === 'sair' && metodo === 'POST') {
    const token = lerCookie(req, 'sessao');
    if (token) await sql`delete from sessao where token_hash = ${hashToken(token)}`;
    definirCookieSessao(res, null, { remover: true });
    return {};
  }

  exigeLogin(eu);

  if (rota === 'senha' && metodo === 'POST') {
    const { atual, nova } = body();
    const [a] = await sql`select senha_hash from atendente where id = ${eu.id}`;
    if (!await conferirSenha(atual, a.senha_hash)) throw new Erro400('Senha atual incorreta.');
    if (String(nova || '').length < 4) throw new Erro400('A nova senha precisa ter pelo menos 4 caracteres.');
    await sql`update atendente set senha_hash = ${await hashSenha(nova)} where id = ${eu.id}`;
    return {};
  }

  if (rota === 'eu' && metodo === 'GET') {
    return { nome: eu.nome, setor: eu.setor, roboOnline: await roboOnline(sql) };
  }

  if (rota === 'conversas' && metodo === 'GET') return listarConversas(sql);

  if (rota === 'mensagens' && metodo === 'GET') {
    const telefone = exigeTelefone(query.telefone);
    return obterMensagens(sql, telefone, Number(query.depois) || 0);
  }

  if (rota === 'enviar' && metodo === 'POST') {
    const { telefone, texto } = body();
    exigeTelefone(telefone);
    const t = limpa(texto, 4000);
    if (!t) throw new Erro400('Mensagem vazia.');
    await sql`insert into mensagem (telefone, remetente, autor, texto) values (${telefone}, 'atendente', ${eu.nome}, ${t})`;
    await sql`insert into saida (tipo, telefone, texto, autor) values ('texto', ${telefone}, ${t}, ${eu.nome})`;
    await sql`update conversa set atualizado_em = now() where telefone = ${telefone}`;
    return {};
  }

  if (rota === 'assumir' && metodo === 'POST') {
    const { telefone } = body();
    exigeTelefone(telefone);
    await sql`update conversa set estado = 'humano', setor = coalesce(setor, ${eu.setor}) where telefone = ${telefone}`;
    return {};
  }

  if (rota === 'encerrar' && metodo === 'POST') {
    const { telefone } = body();
    exigeTelefone(telefone);
    const [c] = await sql`select textos->>'encerramentoHumano' as texto from conteudo where id = 1`;
    const texto = c?.texto || 'Encerrando por aqui. Se precisar de algo mais, é só chamar!';
    await sql`insert into mensagem (telefone, remetente, texto) values (${telefone}, 'bot', ${texto})`;
    await sql`insert into saida (tipo, telefone, texto) values ('texto', ${telefone}, ${texto})`;
    await sql`update conversa set estado = null where telefone = ${telefone}`;
    return {};
  }

  if (rota === 'transferir' && metodo === 'POST') {
    const { telefone, setor } = body();
    exigeTelefone(telefone);
    await sql`update conversa set setor = ${setor} where telefone = ${telefone}`;
    return {};
  }

  if (rota === 'renomear' && metodo === 'POST') {
    const { telefone, nome } = body();
    exigeTelefone(telefone);
    await sql`update conversa set nome = ${limpa(nome, 60)} where telefone = ${telefone}`;
    return {};
  }

  if (rota === 'midia' && metodo === 'POST') {
    const { telefone, base64, tipo, nomeArquivo, legenda } = body();
    exigeTelefone(telefone);
    const dados = Buffer.from(String(base64 || ''), 'base64');
    if (dados.length > MAX_MIDIA) throw new Erro400('Arquivo grande demais.');
    const [m] = await sql`insert into midia (tipo, nome, dados) values (${tipo || 'application/octet-stream'}, ${nomeArquivo || null}, ${dados}) returning id`;
    const leg = limpa(legenda, 1000);
    await sql`insert into mensagem (telefone, remetente, autor, texto, midia_id, midia_tipo) values (${telefone}, 'atendente', ${eu.nome}, ${leg}, ${m.id}, ${tipo})`;
    await sql`insert into saida (tipo, telefone, texto, midia_id, midia_tipo, nome_arquivo, autor) values ('midia', ${telefone}, ${leg}, ${m.id}, ${tipo}, ${nomeArquivo || null}, ${eu.nome})`;
    return {};
  }

  if (rota === 'nova' && metodo === 'POST') {
    const { numero, texto } = body();
    const digitos = String(numero || '').replace(/\D/g, '');
    if (digitos.length < 10) throw new Erro400('Número inválido.');
    const t = limpa(texto, 4000) || 'Olá!';
    await sql`insert into saida (tipo, numero, texto, autor, setor) values ('nova', ${digitos}, ${t}, ${eu.nome}, ${eu.setor})`;
    return {};
  }

  if (rota === 'prontas' && metodo === 'GET') return sql`select id, titulo, texto from pronta order by titulo`;
  if (rota === 'prontas' && metodo === 'POST') {
    const { titulo, texto } = body();
    if (!limpa(titulo, 60) || !limpa(texto, 4000)) throw new Erro400('Preencha nome e texto.');
    await sql`insert into pronta (titulo, texto) values (${limpa(titulo, 60)}, ${limpa(texto, 4000)})`;
    return {};
  }
  if (rota === 'prontas' && metodo === 'DELETE') {
    await sql`delete from pronta where id = ${Number(query.id)}`;
    return {};
  }

  if (rota === 'comprovantes' && metodo === 'GET') {
    const linhas = await sql`
      select id, telefone, nome, categoria, midia_id as "midiaId", midia_tipo as "midiaTipo",
        valor, data_pagamento as "dataPagamento", descricao, criado_em as "criadoEm"
      from comprovante order by criado_em desc limit 300
    `;
    return linhas;
  }

  if (rota === 'textos' && metodo === 'GET') {
    const [c] = await sql`select textos, versao, atualizado_em as "atualizadoEm", atualizado_por as "atualizadoPor" from conteudo where id = 1`;
    return c || { textos: {}, versao: 0, atualizadoEm: null, atualizadoPor: null };
  }
  if (rota === 'textos' && metodo === 'PUT') {
    const { textos } = body();
    const [atual] = await sql`select versao from conteudo where id = 1`;
    const versao = (atual?.versao || 0) + 1;
    await sql`
      insert into conteudo (id, versao, textos, atualizado_em, atualizado_por)
      values (1, ${versao}, ${sql.json(textos)}, now(), ${eu.nome})
      on conflict (id) do update set versao = ${versao}, textos = ${sql.json(textos)}, atualizado_em = now(), atualizado_por = ${eu.nome}
    `;
    return { versao };
  }

  if (rota === 'teste' && metodo === 'POST') return processarTeste(sql, eu, body());
  if (rota === 'teste' && metodo === 'GET') return consultarTeste(sql, Number(query.id));

  // agenda, compromissos, confirmações, expediente, padres
  const PREFIXOS_AGENDA = ['agenda/', 'compromissos', 'confirmacoes/', 'expediente', 'padres'];
  if (PREFIXOS_AGENDA.some((p) => rota === p || rota.startsWith(p))) {
    return rotasAgenda({ rota, metodo, sql, eu, corpo: body(), query });
  }

  throw new Erro404('Rota não encontrada.');
}
