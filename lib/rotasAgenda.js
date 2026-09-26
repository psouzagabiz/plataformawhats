// Rotas da Agenda, Confirmações e Configurações (delegadas por api/principal.js).
// NOTA DE RECONSTRUÇÃO: ver o aviso em lib/confirmacao.js — o contrato JSON foi inferido
// lendo public/agenda.js (que chama estas rotas), não do código original do servidor.
import { Erro400, Erro404 } from './erros.js';
import { TIPOS, STATUS, ATIVOS, calcularPrazo, buscarExpediente, salvarExpediente } from './agenda.js';
import { roboOnline } from './presenca.js';

const limpa = (t, max) => String(t ?? '').trim().slice(0, max);

async function opcoes(sql, eu) {
  const padres = await sql`select id, nome, whatsapp, ativo from padre where paroquia_id = ${eu.paroquiaId} order by nome`;
  return {
    padres,
    tipos: TIPOS,
    status: STATUS,
    ativos: ATIVOS,
    roboOnline: await roboOnline(sql, eu.paroquiaId),
    exemploMensagem: 'Olá! Passando para confirmar o seu compromisso na paróquia:\n\n*Direção espiritual*\n📅 12/10 às 15:00\n📍 Igreja Matriz\n\nVocê confirma sua presença? Responda com o número:\n1 - Confirmar presença\n2 - Solicitar alteração\n3 - Cancelar compromisso',
  };
}

function linhaCompromisso(c) {
  return {
    id: c.id, tipo: c.tipo, padreId: c.padre_id, padreNome: c.padre_nome,
    data: c.data, hora: String(c.hora).slice(0, 5),
    pessoaNome: c.pessoa_nome, pessoaWhatsapp: c.pessoa_whatsapp,
    local: c.local, endereco: c.endereco, observacoes: c.observacoes,
    exigeConfirmacao: c.exige_confirmacao, status: c.status,
    prazoConfirmacao: c.prazo_confirmacao, confirmacaoEnviadaEm: c.confirmacao_enviada_em,
    respondidoEm: c.respondido_em, desmarcadoEm: c.desmarcado_em, ultimoErro: c.ultimo_erro,
    criadoPor: c.criado_por, criadoEm: c.criado_em,
  };
}

async function listarCompromissos(sql, eu, q) {
  const de = q.de || '1900-01-01';
  const ate = q.ate || '2999-12-31';
  const condicoes = [sql`c.paroquia_id = ${eu.paroquiaId}`, sql`c.data between ${de} and ${ate}`];
  if (q.padre) condicoes.push(sql`c.padre_id = ${Number(q.padre)}`);
  if (q.tipo) condicoes.push(sql`c.tipo = ${q.tipo}`);
  if (q.status === 'ativos') condicoes.push(sql`c.status = any(${ATIVOS})`);
  else if (q.status) condicoes.push(sql`c.status = ${q.status}`);
  if (q.confirmacao === '1') condicoes.push(sql`c.exige_confirmacao`);
  if (q.erro === '1') condicoes.push(sql`c.ultimo_erro is not null`);
  const where = condicoes.reduce((acc, c, i) => (i === 0 ? c : sql`${acc} and ${c}`));
  const linhas = await sql`
    select c.*, p.nome as padre_nome from compromisso c left join padre p on p.id = c.padre_id
    where ${where} order by c.data, c.hora
  `;
  return linhas.map(linhaCompromisso);
}

async function criarOuAtualizarCompromisso(sql, eu, corpo) {
  const dados = {
    tipo: limpa(corpo.tipo, 20) || 'outro',
    padreId: corpo.padreId ? Number(corpo.padreId) : null,
    data: corpo.data,
    hora: corpo.hora,
    pessoaNome: limpa(corpo.pessoaNome, 100),
    pessoaWhatsapp: limpa(corpo.pessoaWhatsapp, 30),
    local: limpa(corpo.local, 150),
    endereco: limpa(corpo.endereco, 200),
    observacoes: limpa(corpo.observacoes, 2000),
    exigeConfirmacao: !!corpo.exigeConfirmacao,
  };
  if (!dados.data || !dados.hora) throw new Erro400('Data e horário são obrigatórios.');
  if (dados.exigeConfirmacao && !dados.pessoaWhatsapp) throw new Erro400('Informe o WhatsApp da pessoa para pedir confirmação.');

  let prazoConfirmacao = null;
  let inicioEnvio = null;
  if (dados.exigeConfirmacao) {
    const calculo = await calcularPrazo(sql, eu.paroquiaId, dados.data);
    if (calculo) { prazoConfirmacao = calculo.prazo; inicioEnvio = calculo.inicioEnvio; }
  }

  if (corpo.id) {
    const [existe] = await sql`select id from compromisso where id = ${Number(corpo.id)} and paroquia_id = ${eu.paroquiaId}`;
    if (!existe) throw new Erro404('Compromisso não encontrado.');
    await sql`
      update compromisso set tipo = ${dados.tipo}, padre_id = ${dados.padreId}, data = ${dados.data}, hora = ${dados.hora},
        pessoa_nome = ${dados.pessoaNome}, pessoa_whatsapp = ${dados.pessoaWhatsapp}, local = ${dados.local},
        endereco = ${dados.endereco}, observacoes = ${dados.observacoes}, exige_confirmacao = ${dados.exigeConfirmacao},
        prazo_confirmacao = ${prazoConfirmacao}, inicio_envio = ${inicioEnvio}, atualizado_em = now()
      where id = ${Number(corpo.id)}
    `;
    await sql`insert into compromisso_historico (paroquia_id, compromisso_id, acao, feito_por) values (${eu.paroquiaId}, ${Number(corpo.id)}, 'editado', ${eu.nome})`;
    return { id: Number(corpo.id) };
  }
  const [novo] = await sql`
    insert into compromisso (paroquia_id, tipo, padre_id, data, hora, pessoa_nome, pessoa_whatsapp, local, endereco,
      observacoes, exige_confirmacao, prazo_confirmacao, inicio_envio, criado_por)
    values (${eu.paroquiaId}, ${dados.tipo}, ${dados.padreId}, ${dados.data}, ${dados.hora}, ${dados.pessoaNome},
      ${dados.pessoaWhatsapp}, ${dados.local}, ${dados.endereco}, ${dados.observacoes}, ${dados.exigeConfirmacao},
      ${prazoConfirmacao}, ${inicioEnvio}, ${eu.nome})
    returning id
  `;
  await sql`insert into compromisso_historico (paroquia_id, compromisso_id, acao, feito_por) values (${eu.paroquiaId}, ${novo.id}, 'criado', ${eu.nome})`;
  return { id: novo.id };
}

async function historico(sql, eu, id) {
  const [c] = await sql`
    select comp.*, p.nome as padre_nome from compromisso comp left join padre p on p.id = comp.padre_id
    where comp.id = ${id} and comp.paroquia_id = ${eu.paroquiaId}
  `;
  if (!c) throw new Erro404('Compromisso não encontrado.');
  const historico = await sql`
    select acao, detalhe, feito_por as "feitoPor", criado_em as "criadoEm"
    from compromisso_historico where compromisso_id = ${id} order by criado_em desc
  `;
  return { compromisso: linhaCompromisso(c), historico };
}

async function marcar(sql, eu, id, status, acao) {
  const [c] = await sql`select id from compromisso where id = ${id} and paroquia_id = ${eu.paroquiaId}`;
  if (!c) throw new Erro404('Compromisso não encontrado.');
  await sql`update compromisso set status = ${status}, atualizado_em = now() where id = ${id}`;
  await sql`insert into compromisso_historico (paroquia_id, compromisso_id, acao, feito_por) values (${eu.paroquiaId}, ${id}, ${acao}, ${eu.nome})`;
  return { ok: true };
}

async function resumoConfirmacoes(sql, eu, q) {
  const de = q.de || '1900-01-01';
  const ate = q.ate || '2999-12-31';
  const linhas = await sql`
    select status, count(*)::int as n from compromisso
    where paroquia_id = ${eu.paroquiaId} and data between ${de} and ${ate} and exige_confirmacao
    group by status
  `;
  const porStatus = Object.fromEntries(linhas.map((l) => [l.status, l.n]));
  const [{ n: errosEnvio }] = await sql`
    select count(*)::int as n from compromisso
    where paroquia_id = ${eu.paroquiaId} and data between ${de} and ${ate} and exige_confirmacao and ultimo_erro is not null
  `;
  const [ultimaRotina] = await sql`select iniciado_em as em, enviados, desmarcados, erros from rotina_execucao order by id desc limit 1`;
  return { porStatus, errosEnvio, roboOnline: await roboOnline(sql, eu.paroquiaId), ultimaRotina: ultimaRotina || null };
}

async function padres(sql, eu, metodo, corpo) {
  if (metodo === 'POST' || (metodo === 'PUT' && corpo.id)) {
    const dados = { nome: limpa(corpo.nome, 80), whatsapp: limpa(corpo.whatsapp, 30), ativo: corpo.ativo !== false };
    if (!dados.nome) throw new Erro400('Nome é obrigatório.');
    if (corpo.id) {
      await sql`update padre set nome = ${dados.nome}, whatsapp = ${dados.whatsapp}, ativo = ${dados.ativo} where id = ${Number(corpo.id)} and paroquia_id = ${eu.paroquiaId}`;
      return { id: Number(corpo.id) };
    }
    const [novo] = await sql`insert into padre (paroquia_id, nome, whatsapp, ativo) values (${eu.paroquiaId}, ${dados.nome}, ${dados.whatsapp}, ${dados.ativo}) returning id`;
    return { id: novo.id };
  }
  throw new Erro400('Método inválido.');
}

export async function rotasAgenda({ rota, metodo, sql, eu, corpo, query }) {
  if (rota === 'agenda/opcoes' && metodo === 'GET') return opcoes(sql, eu);

  if (rota === 'compromissos' && metodo === 'GET') return listarCompromissos(sql, eu, query);
  if (rota === 'compromissos' && (metodo === 'POST' || metodo === 'PUT')) return criarOuAtualizarCompromisso(sql, eu, corpo);
  if (rota === 'compromissos/historico' && metodo === 'GET') return historico(sql, eu, Number(query.id));
  if (rota === 'compromissos/realizado' && metodo === 'POST') return marcar(sql, eu, Number(corpo.id), 'realizado', 'marcado_realizado');
  if (rota === 'compromissos/cancelar' && metodo === 'POST') return marcar(sql, eu, Number(corpo.id), 'cancelado', 'cancelado_pela_secretaria');

  if (rota === 'confirmacoes/resumo' && metodo === 'GET') return resumoConfirmacoes(sql, eu, query);

  if (rota === 'expediente' && metodo === 'GET') return buscarExpediente(sql, eu.paroquiaId);
  if (rota === 'expediente' && metodo === 'PUT') { await salvarExpediente(sql, eu.paroquiaId, corpo); return { ok: true }; }
  if (rota === 'expediente/simular' && metodo === 'GET') {
    const calculo = await calcularPrazo(sql, eu.paroquiaId, query.data);
    return calculo ? { inicioEnvio: calculo.inicioEnvio, prazo: calculo.prazo } : {};
  }

  if (rota === 'padres') return padres(sql, eu, metodo, corpo);

  throw new Erro404('Rota de agenda não encontrada.');
}
