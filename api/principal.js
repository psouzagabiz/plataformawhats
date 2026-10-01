// API da plataforma de atendimento. Todas as rotas /api/* chegam aqui (ver vercel.json).
//
// NOTA DE RECONSTRUÇÃO: ver o aviso no topo do histórico deste arquivo em ARQUITETURA.md —
// o roteador original foi perdido quase por completo e isto é uma reconstrução de boa-fé.
//
// NOTA MULTI-INSTITUIÇÃO (2026-09-26): `conversa` e `mensagem` são chaveadas por
// `telefone`, sem `paroquia_id` na chave primária (não mexemos na PK de uma tabela já em
// produção — ver lib/banco.js). Isso significa que, se a MESMA pessoa (mesmo número de
// WhatsApp) escrever para DUAS instituições diferentes, as duas conversas colidiriam numa
// única linha. Todas as rotas abaixo filtram por `paroquia_id` como proteção (uma
// instituição nunca lê/escreve na conversa de outra), mas nesse cenário raro a pessoa
// simplesmente não conseguiria ter uma conversa registrada com a segunda instituição até
// isso ser corrigido de verdade (mudar a chave primária para (paroquia_id, telefone) —
// deixado como próximo passo, não feito agora para não mexer numa chave primária já usada
// em produção sem necessidade imediata).
import { banco, garantirEsquema } from '../lib/banco.js';
import {
  hashSenha, conferirSenha, novoToken, hashToken, ipDe, lerCookie,
  bloqueado, registrarFalha, limparFalhas,
} from '../lib/seguranca.js';
import { rotasAgenda } from '../lib/rotasAgenda.js';
import { processarTeste, consultarTeste } from '../lib/teste.js';
import { roboOnline } from '../lib/presenca.js';
import { Erro, Erro400, Erro403, Erro404, Erro429 } from '../lib/erros.js';
import { enviarCampanha } from '../lib/campanhas.js';

const GRUPOS_VALIDOS = ['dizimistas', 'catequese', 'pastoral'];
const PIX_CHAVE_DIZIMO = 'santanaposse@hotmail.com';

const DURACAO_SESSAO_DIAS = 7;
const MAX_MIDIA = 3 * 1024 * 1024; // limite de envio da Vercel (~4,5 MB com base64)
const TELEFONE = /^[0-9]{5,20}@(c\.us|lid)$/;
const TIPOS_INSTITUICAO = ['paroquia', 'escola', 'outro'];
const MAX_CADASTROS_POR_HORA = 3;

const limpa = (t, max) => String(t ?? '').trim().slice(0, max);
function exigeTelefone(t) {
  if (!TELEFONE.test(String(t))) throw new Erro400('Conversa inválida');
  return t;
}

// Converte um telefone de planilha/CSV (com ou sem DDI, com ou sem formatação) para o
// formato de JID do WhatsApp usado em "conversa.telefone" (ex.: 5511982114432@c.us).
function normalizarTelefone(bruto) {
  let digitos = String(bruto ?? '').replace(/\D/g, '');
  if (!digitos) return null;
  if (digitos.length <= 11) digitos = '55' + digitos; // sem DDI: assume Brasil
  if (digitos.length < 12 || digitos.length > 13) return null;
  return `${digitos}@c.us`;
}

// Aceita DD/MM/AAAA, DD-MM-AAAA ou AAAA-MM-DD e devolve AAAA-MM-DD (ou null).
function normalizarData(bruto) {
  const s = String(bruto ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
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

async function criarSessao(sql, res, atendenteId) {
  const token = novoToken();
  const expiraEm = new Date(Date.now() + DURACAO_SESSAO_DIAS * 24 * 60 * 60 * 1000);
  await sql`insert into sessao (token_hash, atendente_id, expira_em) values (${hashToken(token)}, ${atendenteId}, ${expiraEm})`;
  definirCookieSessao(res, token);
}

async function atendenteLogado(req) {
  const token = lerCookie(req, 'sessao');
  if (!token) return null;
  const sql = banco();
  const [linha] = await sql`
    select a.id, a.nome, a.setor, a.papel, a.paroquia_id as "paroquiaId"
    from sessao s join atendente a on a.id = s.atendente_id join paroquia p on p.id = a.paroquia_id
    where s.token_hash = ${hashToken(token)} and s.expira_em > now() and p.status = 'ativa'
  `;
  return linha || null;
}

function exigeLogin(eu) {
  if (!eu) throw new Erro(401, 'Sessão expirada. Entre novamente.');
  return eu;
}
function exigeSuperAdmin(eu) {
  if (eu?.papel !== 'super_admin') throw new Erro403('Só a administradora da plataforma pode acessar isso.');
  return eu;
}

/* =================== CONVERSAS E MENSAGENS =================== */
async function listarConversas(sql, paroquiaId) {
  const linhas = await sql`
    select c.telefone, c.nome, c.estado, c.setor,
      m.texto as ultima_texto, m.midia_id as ultima_midia, m.remetente as ultima_remetente, m.criado_em as ultima_em
    from conversa c
    left join lateral (
      select texto, midia_id, remetente, criado_em from mensagem where telefone = c.telefone order by id desc limit 1
    ) m on true
    where c.paroquia_id = ${paroquiaId}
    order by coalesce(m.criado_em, c.atualizado_em) desc
    limit 500
  `;
  return linhas.map((c) => ({
    telefone: c.telefone, nome: c.nome, estado: c.estado, setor: c.setor,
    ultimaTexto: c.ultima_texto, ultimaMidia: !!c.ultima_midia, ultimaRemetente: c.ultima_remetente, ultimaEm: c.ultima_em,
  }));
}

async function obterMensagens(sql, paroquiaId, telefone, depois) {
  const [conversa] = await sql`select telefone, nome, estado, setor from conversa where telefone = ${telefone} and paroquia_id = ${paroquiaId}`;
  if (!conversa) return { conversa: null, mensagens: [], enviando: false };
  const linhas = await sql`
    select id, remetente, autor, texto, midia_id as "midiaId", midia_tipo as "midiaTipo", criado_em as "criadoEm"
    from mensagem where telefone = ${telefone} and paroquia_id = ${paroquiaId} and id > ${depois} order by id asc limit 300
  `;
  const [pendente] = await sql`
    select 1 from saida where telefone = ${telefone} and paroquia_id = ${paroquiaId} and entregue_em is null and erro is null and tipo in ('texto', 'midia')
  `;
  return { conversa, mensagens: linhas, enviando: !!pendente };
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
      const eu = exigeLogin(await atendenteLogado(req));
      const id = Number(req.query.id);
      const [dono] = await sql`
        select 1 from (
          select midia_id, paroquia_id from mensagem where midia_id = ${id}
          union all select midia_id, paroquia_id from comprovante where midia_id = ${id}
          union all select midia_id, paroquia_id from saida where midia_id = ${id}
        ) x where paroquia_id = ${eu.paroquiaId} limit 1
      `;
      if (!dono) throw new Erro404('Arquivo não encontrado.');
      const [m] = await sql`select tipo, dados from midia where id = ${id}`;
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

  /* ---------- público, sem sessão ---------- */
  if (rota === 'instituicoes' && metodo === 'GET') {
    const busca = limpa(query.busca, 80);
    if (busca.length < 2) return [];
    return sql`
      select id, nome, cidade from paroquia
      where status = 'ativa' and nome ilike ${'%' + busca + '%'}
      order by nome limit 10
    `;
  }

  if (rota === 'instituicoes' && metodo === 'POST') {
    const ip = ipDe(req);
    const [{ n }] = await sql`select count(*)::int as n from tentativa_cadastro where ip = ${ip} and criado_em > now() - interval '1 hour'`;
    if (n >= MAX_CADASTROS_POR_HORA) throw new Erro429('Muitos cadastros a partir deste endereço. Tente novamente mais tarde.');
    await sql`insert into tentativa_cadastro (ip) values (${ip})`;

    const { nomeInstituicao, tipo, nomeResponsavel, senha, contatoEmail } = body();
    const nome = limpa(nomeInstituicao, 120);
    const responsavel = limpa(nomeResponsavel, 80);
    if (!nome) throw new Erro400('Informe o nome da instituição.');
    if (!responsavel) throw new Erro400('Informe seu nome.');
    if (String(senha || '').length < 4) throw new Erro400('A senha precisa ter pelo menos 4 caracteres.');
    const tipoValido = TIPOS_INSTITUICAO.includes(tipo) ? tipo : 'outro';

    const [instituicao] = await sql`
      insert into paroquia (nome, tipo, contato_nome, contato_email)
      values (${nome}, ${tipoValido}, ${responsavel}, ${limpa(contatoEmail, 120) || null})
      returning id
    `;
    const [atendente] = await sql`
      insert into atendente (nome, setor, senha_hash, paroquia_id, papel)
      values (${responsavel}, 'recepcao', ${await hashSenha(senha)}, ${instituicao.id}, 'admin')
      on conflict (nome) do nothing
      returning id
    `;
    if (!atendente) throw new Erro400('Já existe um atendente com esse nome. Escolha outro nome para continuar.');
    await criarSessao(sql, res, atendente.id);
    return { paroquiaId: instituicao.id };
  }

  if (rota === 'atendentes' && metodo === 'GET') {
    const paroquiaId = Number(query.paroquiaId);
    if (!paroquiaId) throw new Erro400('Escolha uma instituição primeiro.');
    return sql`select id, nome, setor from atendente where paroquia_id = ${paroquiaId} order by id`;
  }

  if (rota === 'entrar' && metodo === 'POST') {
    const { atendenteId, senha } = body();
    const ip = ipDe(req);
    const [a] = await sql`
      select at.id, at.nome, at.senha_hash, p.status as "statusInstituicao"
      from atendente at join paroquia p on p.id = at.paroquia_id
      where at.id = ${Number(atendenteId)}
    `;
    if (await bloqueado(sql, { ip, atendenteId: a?.id })) {
      throw new Erro429('Muitas tentativas. Aguarde alguns minutos e tente novamente.');
    }
    const ok = a && await conferirSenha(senha, a.senha_hash);
    if (!ok) {
      await registrarFalha(sql, { ip, atendenteId: a?.id });
      throw new Erro(401, 'Nome ou senha incorretos.');
    }
    if (a.statusInstituicao !== 'ativa') throw new Erro(403, 'Esta instituição está suspensa. Fale com o suporte.');
    await limparFalhas(sql, a.id);
    await criarSessao(sql, res, a.id);
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
    return {
      nome: eu.nome, setor: eu.setor, roboOnline: await roboOnline(sql, eu.paroquiaId),
      superAdmin: eu.papel === 'super_admin',
    };
  }

  if (rota === 'conversas' && metodo === 'GET') return listarConversas(sql, eu.paroquiaId);

  if (rota === 'mensagens' && metodo === 'GET') {
    const telefone = exigeTelefone(query.telefone);
    return obterMensagens(sql, eu.paroquiaId, telefone, Number(query.depois) || 0);
  }

  if (rota === 'enviar' && metodo === 'POST') {
    const { telefone, texto } = body();
    exigeTelefone(telefone);
    const t = limpa(texto, 4000);
    if (!t) throw new Erro400('Mensagem vazia.');
    await sql`insert into mensagem (telefone, remetente, autor, texto, paroquia_id) values (${telefone}, 'atendente', ${eu.nome}, ${t}, ${eu.paroquiaId})`;
    await sql`insert into saida (tipo, telefone, texto, autor, paroquia_id) values ('texto', ${telefone}, ${t}, ${eu.nome}, ${eu.paroquiaId})`;
    await sql`update conversa set atualizado_em = now() where telefone = ${telefone} and paroquia_id = ${eu.paroquiaId}`;
    return {};
  }

  if (rota === 'assumir' && metodo === 'POST') {
    const { telefone } = body();
    exigeTelefone(telefone);
    await sql`update conversa set estado = 'humano', setor = coalesce(setor, ${eu.setor}) where telefone = ${telefone} and paroquia_id = ${eu.paroquiaId}`;
    return {};
  }

  if (rota === 'encerrar' && metodo === 'POST') {
    const { telefone } = body();
    exigeTelefone(telefone);
    const [c] = await sql`select textos->>'encerramentoHumano' as texto from conteudo where paroquia_id = ${eu.paroquiaId}`;
    const texto = c?.texto || 'Encerrando por aqui. Se precisar de algo mais, é só chamar!';
    await sql`insert into mensagem (telefone, remetente, texto, paroquia_id) values (${telefone}, 'bot', ${texto}, ${eu.paroquiaId})`;
    await sql`insert into saida (tipo, telefone, texto, paroquia_id) values ('texto', ${telefone}, ${texto}, ${eu.paroquiaId})`;
    await sql`update conversa set estado = null where telefone = ${telefone} and paroquia_id = ${eu.paroquiaId}`;
    return {};
  }

  if (rota === 'transferir' && metodo === 'POST') {
    const { telefone, setor } = body();
    exigeTelefone(telefone);
    await sql`update conversa set setor = ${setor} where telefone = ${telefone} and paroquia_id = ${eu.paroquiaId}`;
    return {};
  }

  if (rota === 'renomear' && metodo === 'POST') {
    const { telefone, nome } = body();
    exigeTelefone(telefone);
    await sql`update conversa set nome = ${limpa(nome, 60)} where telefone = ${telefone} and paroquia_id = ${eu.paroquiaId}`;
    return {};
  }

  if (rota === 'midia' && metodo === 'POST') {
    const { telefone, base64, tipo, nomeArquivo, legenda } = body();
    exigeTelefone(telefone);
    const dados = Buffer.from(String(base64 || ''), 'base64');
    if (dados.length > MAX_MIDIA) throw new Erro400('Arquivo grande demais.');
    const [m] = await sql`insert into midia (tipo, nome, dados) values (${tipo || 'application/octet-stream'}, ${nomeArquivo || null}, ${dados}) returning id`;
    const leg = limpa(legenda, 1000);
    await sql`insert into mensagem (telefone, remetente, autor, texto, midia_id, midia_tipo, paroquia_id) values (${telefone}, 'atendente', ${eu.nome}, ${leg}, ${m.id}, ${tipo}, ${eu.paroquiaId})`;
    await sql`insert into saida (tipo, telefone, texto, midia_id, midia_tipo, nome_arquivo, autor, paroquia_id) values ('midia', ${telefone}, ${leg}, ${m.id}, ${tipo}, ${nomeArquivo || null}, ${eu.nome}, ${eu.paroquiaId})`;
    return {};
  }

  if (rota === 'nova' && metodo === 'POST') {
    const { numero, texto } = body();
    const digitos = String(numero || '').replace(/\D/g, '');
    if (digitos.length < 10) throw new Erro400('Número inválido.');
    const t = limpa(texto, 4000) || 'Olá!';
    await sql`insert into saida (tipo, numero, texto, autor, setor, paroquia_id) values ('nova', ${digitos}, ${t}, ${eu.nome}, ${eu.setor}, ${eu.paroquiaId})`;
    return {};
  }

  if (rota === 'prontas' && metodo === 'GET') return sql`select id, titulo, texto from pronta where paroquia_id = ${eu.paroquiaId} order by titulo`;
  if (rota === 'prontas' && metodo === 'POST') {
    const { titulo, texto } = body();
    if (!limpa(titulo, 60) || !limpa(texto, 4000)) throw new Erro400('Preencha nome e texto.');
    await sql`insert into pronta (titulo, texto, paroquia_id) values (${limpa(titulo, 60)}, ${limpa(texto, 4000)}, ${eu.paroquiaId})`;
    return {};
  }
  if (rota === 'prontas' && metodo === 'DELETE') {
    await sql`delete from pronta where id = ${Number(query.id)} and paroquia_id = ${eu.paroquiaId}`;
    return {};
  }

  if (rota === 'comprovantes' && metodo === 'GET') {
    return sql`
      select id, telefone, nome, categoria, midia_id as "midiaId", midia_tipo as "midiaTipo",
        valor, data_pagamento as "dataPagamento", descricao, criado_em as "criadoEm"
      from comprovante where paroquia_id = ${eu.paroquiaId} order by criado_em desc limit 300
    `;
  }

  if (rota === 'textos' && metodo === 'GET') {
    const [c] = await sql`select textos, versao, atualizado_em as "atualizadoEm", atualizado_por as "atualizadoPor" from conteudo where paroquia_id = ${eu.paroquiaId}`;
    return c || { textos: {}, versao: 0, atualizadoEm: null, atualizadoPor: null };
  }
  if (rota === 'textos' && metodo === 'PUT') {
    const { textos } = body();
    const [atual] = await sql`select versao from conteudo where paroquia_id = ${eu.paroquiaId}`;
    const versao = (atual?.versao || 0) + 1;
    await sql`
      insert into conteudo (versao, textos, atualizado_em, atualizado_por, paroquia_id)
      values (${versao}, ${sql.json(textos)}, now(), ${eu.nome}, ${eu.paroquiaId})
      on conflict (paroquia_id) do update set versao = ${versao}, textos = ${sql.json(textos)}, atualizado_em = now(), atualizado_por = ${eu.nome}
    `;
    return { versao };
  }

  if (rota === 'teste' && metodo === 'POST') return processarTeste(sql, eu, body());
  if (rota === 'teste' && metodo === 'GET') return consultarTeste(sql, Number(query.id));

  /* ---------- campanhas (envio em massa segmentado) ---------- */
  if (rota === 'campanhas' && metodo === 'GET') {
    return sql`select id, titulo, mensagem, grupos, destinatarios, criado_em as "criadoEm" from campanha where paroquia_id = ${eu.paroquiaId} order by criado_em desc limit 100`;
  }
  if (rota === 'campanhas' && metodo === 'POST') {
    const { titulo, mensagem, grupos } = body();
    if (!limpa(titulo, 120) || !limpa(mensagem, 4000)) throw new Erro400('Preencha o título e a mensagem.');
    const gruposValidos = (Array.isArray(grupos) ? grupos : []).filter((g) => GRUPOS_VALIDOS.includes(g));
    if (!gruposValidos.length) throw new Erro400('Escolha pelo menos um grupo.');
    return enviarCampanha(sql, {
      paroquiaId: eu.paroquiaId, titulo: limpa(titulo, 120), mensagem: limpa(mensagem, 4000),
      grupos: gruposValidos, criadoPor: eu.nome,
    });
  }

  /* ---------- lembretes automáticos por data ---------- */
  if (rota === 'regras-automaticas' && metodo === 'GET') {
    return sql`select id, tipo, titulo, mensagem, dia_do_mes as "diaDoMes", ativa, criado_em as "criadoEm" from regra_automatica where paroquia_id = ${eu.paroquiaId} order by criado_em desc`;
  }
  if (rota === 'regras-automaticas' && metodo === 'POST') {
    const { tipo, titulo, mensagem, diaDoMes } = body();
    if (!['aniversario', 'dizimo_mensal', 'lembrete'].includes(tipo)) throw new Erro400('Tipo de regra inválido.');
    if (!limpa(titulo, 120) || !limpa(mensagem, 2000)) throw new Erro400('Preencha o nome e a mensagem.');
    const dia = tipo === 'aniversario' ? null : Number(diaDoMes);
    if (tipo !== 'aniversario' && !(dia >= 1 && dia <= 28)) throw new Erro400('Escolha um dia do mês entre 1 e 28.');
    const [regra] = await sql`
      insert into regra_automatica (paroquia_id, tipo, titulo, mensagem, dia_do_mes)
      values (${eu.paroquiaId}, ${tipo}, ${limpa(titulo, 120)}, ${limpa(mensagem, 2000)}, ${dia})
      returning id, tipo, titulo, mensagem, dia_do_mes as "diaDoMes", ativa, criado_em as "criadoEm"
    `;
    return regra;
  }
  if (rota === 'regras-automaticas/executar' && metodo === 'POST') {
    const { executarRegrasAutomaticasHoje } = await import('../lib/campanhas.js');
    return executarRegrasAutomaticasHoje(sql);
  }
  if (rota.startsWith('regras-automaticas/') && metodo === 'PATCH') {
    const id = Number(rota.split('/')[1]);
    const [r] = await sql`update regra_automatica set ativa = not ativa where id = ${id} and paroquia_id = ${eu.paroquiaId} returning id, ativa`;
    if (!r) throw new Erro404('Regra não encontrada.');
    return r;
  }

  /* ---------- dízimo via Pix ----------
  Chave fixa (não é o Mercado Pago configurado no projeto — aquele é só para a assinatura
  do próprio sistema). Só devolve o texto pronto pra secretaria mandar na conversa; quem
  efetivamente envia é o botão "Pix" no chat (public/app.js), que insere isto no campo de
  texto antes de enviar. */
  if (rota === 'pix/chave' && metodo === 'GET') {
    return {
      chave: PIX_CHAVE_DIZIMO,
      texto: `Nossa chave Pix para o dízimo é:\n\n${PIX_CHAVE_DIZIMO}\n\nDeus lhe abençoe! 🙏`,
    };
  }

  /* ---------- importar dizimistas aniversariantes ---------- */
  if (rota === 'dizimistas/importar' && metodo === 'POST') {
    const { linhas } = body();
    if (!Array.isArray(linhas) || !linhas.length) throw new Erro400('Nenhuma linha para importar.');
    let importados = 0;
    const invalidos = [];
    for (const linha of linhas) {
      const telefone = normalizarTelefone(linha.telefone);
      const aniversario = normalizarData(linha.aniversario);
      const nome = limpa(linha.nome, 120);
      if (!telefone || !nome) { invalidos.push(linha); continue; }
      await sql`
        insert into conversa (telefone, nome, aniversario, grupos, paroquia_id)
        values (${telefone}, ${nome}, ${aniversario}, ${sql.array(['dizimistas'])}, ${eu.paroquiaId})
        on conflict (telefone) do update set
          nome = ${nome},
          aniversario = coalesce(${aniversario}, conversa.aniversario),
          grupos = (select array(select distinct unnest(conversa.grupos || ${sql.array(['dizimistas'])})))
      `;
      importados++;
    }
    return { importados, invalidos: invalidos.length };
  }

  /* ---------- painel matriz (super-admin) ---------- */
  if (rota.startsWith('matriz/')) {
    exigeSuperAdmin(eu);
    return rotasMatriz({ rota, metodo, sql, corpo: body() });
  }

  // agenda, compromissos, confirmações, expediente, padres
  const PREFIXOS_AGENDA = ['agenda/', 'compromissos', 'confirmacoes/', 'expediente', 'padres'];
  if (PREFIXOS_AGENDA.some((p) => rota === p || rota.startsWith(p))) {
    return rotasAgenda({ rota, metodo, sql, eu, corpo: body(), query });
  }

  throw new Erro404('Rota não encontrada.');
}

/* =================== PAINEL MATRIZ (super-admin) =================== */
async function rotasMatriz({ rota, metodo, sql, corpo }) {
  if (rota === 'matriz/instituicoes' && metodo === 'GET') {
    return sql`
      select p.id, p.nome, p.tipo, p.status, p.criado_em as "criadoEm",
        (select count(*)::int from atendente a where a.paroquia_id = p.id) as "totalAtendentes",
        (select count(*)::int from conversa c where c.paroquia_id = p.id and c.estado = 'humano') as "conversasAtivas"
      from paroquia p order by p.criado_em desc
    `;
  }
  if (rota === 'matriz/instituicoes/suspender' && metodo === 'POST') {
    await sql`update paroquia set status = 'suspensa' where id = ${Number(corpo.id)}`;
    return { ok: true };
  }
  if (rota === 'matriz/instituicoes/reativar' && metodo === 'POST') {
    await sql`update paroquia set status = 'ativa' where id = ${Number(corpo.id)}`;
    return { ok: true };
  }
  throw new Erro404('Rota do painel matriz não encontrada.');
}
