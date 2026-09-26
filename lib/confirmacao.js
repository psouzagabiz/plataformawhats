// Rotina de confirmações de presença: enfileira mensagens no robô, processa respostas
// (1/2/3) e desmarca automaticamente quem não respondeu no prazo.
//
// NOTA DE RECONSTRUÇÃO IMPORTANTE: a implementação original deste arquivo foi perdida por
// completo (nunca foi lida nesta sessão — a API de leitura de arquivos da Vercel corta
// arquivos grandes). O código abaixo é uma reconstrução de boa-fé a partir do schema real
// do banco (tabelas compromisso/saida/rotina_execucao/resposta_recebida) e do texto da
// interface (public/agenda.js, public/teste.js). Trata-se de lógica de negócio não-trivial
// e NÃO deve ser considerada equivalente ao comportamento original sem validação cuidadosa
// antes de qualquer uso real — em especial o contrato exato com o "robô" (como ele lê a
// fila `saida`, como reporta entrega/erro, e como envia a resposta da pessoa de volta) é
// desconhecido e pode precisar de ajuste depois de olhar o código do robô (não faz parte
// deste repositório).
import { banco } from './banco.js';
import { calcularPrazo, TIPOS } from './agenda.js';

export const OPCOES_RESPOSTA = ['Confirmar presença', 'Solicitar alteração', 'Cancelar compromisso'];

function formatarDataBR(iso) {
  return iso.split('-').reverse().join('/');
}

export function montarMensagemConfirmacao(c) {
  const linhas = [
    'Olá! Passando para confirmar o seu compromisso na paróquia:',
    '',
    `*${TIPOS[c.tipo] || c.tipo}*`,
    `📅 ${formatarDataBR(c.data)} às ${String(c.hora).slice(0, 5)}`,
  ];
  if (c.local) linhas.push(`📍 ${c.local}`);
  linhas.push('', 'Você confirma sua presença? Responda com o número:',
    '1 - Confirmar presença', '2 - Solicitar alteração', '3 - Cancelar compromisso');
  return linhas.join('\n');
}

// Coloca na fila do robô as confirmações cujo horário de envio já chegou, e desmarca
// automaticamente quem passou do prazo sem responder. Chamada a cada minuto por
// api/rotina.js (pg_cron).
export async function executarRotina(origem = '') {
  const sql = banco();
  const [exec] = await sql`insert into rotina_execucao (origem) values (${origem}) returning id`;
  let enviados = 0;
  let desmarcados = 0;
  let erros = 0;
  try {
    const aEnviar = await sql`
      select * from compromisso
      where status = 'agendado' and exige_confirmacao and confirmacao_enviada_em is null
        and inicio_envio is not null and inicio_envio <= now()
    `;
    for (const c of aEnviar) {
      try {
        const [s] = await sql`
          insert into saida (tipo, numero, texto, referencia, valido_ate, paroquia_id)
          values ('confirmacao', ${c.pessoa_whatsapp}, ${montarMensagemConfirmacao(c)}, ${'compromisso:' + c.id}, ${c.prazo_confirmacao}, ${c.paroquia_id})
          returning id
        `;
        await sql`
          update compromisso set status = 'aguardando_confirmacao', confirmacao_enviada_em = now(),
            confirmacao_saida_id = ${s.id}, tentativas_envio = tentativas_envio + 1
          where id = ${c.id}
        `;
        await sql`insert into compromisso_historico (paroquia_id, compromisso_id, acao, feito_por)
          values (${c.paroquia_id}, ${c.id}, 'confirmacao_enviada', 'sistema')`;
        enviados++;
      } catch (e) {
        await sql`update compromisso set ultimo_erro = ${String(e.message)} where id = ${c.id}`;
        await sql`insert into compromisso_historico (paroquia_id, compromisso_id, acao, detalhe, feito_por)
          values (${c.paroquia_id}, ${c.id}, 'erro_envio', ${String(e.message)}, 'sistema')`;
        erros++;
      }
    }

    const vencidos = await sql`
      select * from compromisso
      where status = 'aguardando_confirmacao' and prazo_confirmacao is not null and prazo_confirmacao <= now()
    `;
    for (const c of vencidos) {
      await sql`update compromisso set status = 'desmarcado_sem_confirmacao', desmarcado_em = now() where id = ${c.id}`;
      await sql`insert into compromisso_historico (paroquia_id, compromisso_id, acao, feito_por)
        values (${c.paroquia_id}, ${c.id}, 'desmarcado_automaticamente', 'sistema')`;
      desmarcados++;
    }

    await descartarEnviosVencidos();
  } catch (e) {
    erros++;
    await sql`update rotina_execucao set terminado_em = now(), enviados = ${enviados}, desmarcados = ${desmarcados}, erros = ${erros}, detalhe = ${String(e.message)} where id = ${exec.id}`;
    throw e;
  }
  await sql`update rotina_execucao set terminado_em = now(), enviados = ${enviados}, desmarcados = ${desmarcados}, erros = ${erros} where id = ${exec.id}`;
  return { enviados, desmarcados, erros };
}

// Mensagens de saída (fila para o robô) que venceram (valido_ate no passado) sem serem
// entregues — provavelmente porque o robô ficou desligado tempo demais.
export async function descartarEnviosVencidos() {
  const sql = banco();
  const vencidas = await sql`
    select id, referencia from saida
    where entregue_em is null and erro is null and valido_ate is not null and valido_ate < now()
  `;
  for (const s of vencidas) {
    await sql`update saida set erro = 'expirado: robô não confirmou entrega a tempo' where id = ${s.id}`;
    if (s.referencia?.startsWith('compromisso:')) {
      const id = Number(s.referencia.split(':')[1]);
      await sql`update compromisso set ultimo_erro = 'Mensagem expirou na fila sem o robô confirmar entrega.' where id = ${id} and status = 'aguardando_confirmacao'`;
    }
  }
  return vencidas.length;
}

// O robô chama isto (via alguma rota autenticada, fora do escopo reconstruído aqui) quando
// consegue (ou falha em) entregar uma mensagem da fila `saida`.
export async function registrarEntrega(saidaId, { erro, msgId } = {}) {
  const sql = banco();
  await sql`update saida set entregue_em = now(), erro = ${erro ?? null} where id = ${saidaId}`;
  if (!erro && msgId) {
    const [s] = await sql`select referencia from saida where id = ${saidaId}`;
    if (s?.referencia?.startsWith('compromisso:')) {
      const id = Number(s.referencia.split(':')[1]);
      await sql`update compromisso set confirmacao_msg_id = ${msgId} where id = ${id}`;
    }
  }
}

// O robô chama isto quando a pessoa responde 1/2/3 a uma confirmação. `origem` é um id
// único do lado do robô/WhatsApp, usado só para não processar a mesma resposta duas vezes.
// `paroquiaId`: qual instituição é dona desse robô — sem isso (ex.: enquanto a rota do
// robô não existir de verdade), a busca cai para todas as instituições, o que pode casar
// com o compromisso errado se duas instituições tiverem a mesma pessoa/telefone.
export async function processarResposta({ origem, telefone, resposta, paroquiaId = null }) {
  const sql = banco();
  if (origem) {
    const [ja] = await sql`select 1 from resposta_recebida where origem = ${origem}`;
    if (ja) return { ok: true, duplicada: true };
    await sql`insert into resposta_recebida (origem) values (${origem})`;
  }
  const [c] = await sql`
    select * from compromisso
    where status = 'aguardando_confirmacao' and pessoa_whatsapp = ${telefone}
      and (${paroquiaId}::int is null or paroquia_id = ${paroquiaId})
    order by prazo_confirmacao asc limit 1
  `;
  if (!c) return { ok: false, motivo: 'nenhum compromisso aguardando confirmação para este número' };

  const mapa = { '1': 'confirmado', '2': 'alteracao_solicitada', '3': 'cancelado_pela_pessoa' };
  const novoStatus = mapa[String(resposta).trim()];
  if (!novoStatus) return { ok: false, motivo: 'resposta inválida' };

  await sql`update compromisso set status = ${novoStatus}, respondido_em = now(), canal_resposta = 'whatsapp' where id = ${c.id}`;
  await sql`insert into compromisso_historico (paroquia_id, compromisso_id, acao, feito_por)
    values (${c.paroquia_id}, ${c.id}, ${novoStatus === 'confirmado' ? 'confirmado_pela_pessoa' : novoStatus === 'alteracao_solicitada' ? 'alteracao_solicitada' : 'cancelado_pela_pessoa'}, 'fiel')`;

  // avisa a secretaria quando não for uma simples confirmação
  if (novoStatus !== 'confirmado') {
    const aviso = novoStatus === 'alteracao_solicitada'
      ? `*Pedido de alteração*: ${c.pessoa_nome || telefone} pediu para alterar o compromisso de ${formatarDataBR(c.data)} às ${String(c.hora).slice(0, 5)}.`
      : `*Cancelamento*: ${c.pessoa_nome || telefone} cancelou o compromisso de ${formatarDataBR(c.data)} às ${String(c.hora).slice(0, 5)}.`;
    await sql`insert into saida (tipo, setor, texto, referencia, paroquia_id) values ('aviso_interno', 'recepcao', ${aviso}, ${'compromisso:' + c.id}, ${c.paroquia_id})`;
  }

  return { ok: true, compromissoId: c.id, status: novoStatus };
}
