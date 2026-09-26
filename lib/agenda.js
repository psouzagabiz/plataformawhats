// Constantes e cálculo de prazo de confirmação, compartilhados por rotasAgenda.js e
// confirmacao.js. RECONSTRUÇÃO: a lógica exata de cálculo de prazo do código original foi
// perdida (ver ARQUITETURA.md); o algoritmo abaixo é uma reconstrução razoável a partir do
// texto da interface ("mensagem enviada às HH:MM do dia anterior; prazo de N minutos antes
// do fim do expediente desse dia" + "sem expediente cadastrado nos dias anteriores") e
// precisa ser validado contra o comportamento esperado antes de confiar cegamente nele.

export const TIPOS = {
  direcao: 'Direção espiritual',
  visita: 'Visita',
  bencao: 'Bênção',
  outro: 'Outro compromisso',
};

export const STATUS = {
  agendado: 'Agendado',
  aguardando_confirmacao: 'Aguardando confirmação',
  confirmado: 'Confirmado',
  alteracao_solicitada: 'Alteração solicitada',
  cancelado_pela_pessoa: 'Cancelado pela pessoa',
  cancelado: 'Cancelado',
  desmarcado_sem_confirmacao: 'Desmarcado',
  realizado: 'Realizado',
};

// Situações que ainda contam como "em aberto" (aparecem em negrito, sem opacidade reduzida)
export const ATIVOS = ['agendado', 'aguardando_confirmacao', 'confirmado', 'alteracao_solicitada'];

// Converte uma data (YYYY-MM-DD) + hora (HH:MM) "de parede" num fuso horário para um
// instante UTC real, usando Intl para achar o offset correto (cobre horário de verão,
// embora o Brasil não use mais desde 2019).
export function wallToUtc(dataISO, horaHHMM, fuso = 'America/Sao_Paulo') {
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  const [h, m] = horaHHMM.split(':').map(Number);
  // primeiro monta como se fosse UTC, depois mede o offset do fuso alvo nesse instante e corrige
  const comoUtc = Date.UTC(ano, mes - 1, dia, h, m, 0);
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(comoUtc));
  const obter = (t) => Number(partes.find((p) => p.type === t)?.value);
  const comoSeFosseUtcNoFuso = Date.UTC(obter('year'), obter('month') - 1, obter('day'), obter('hour'), obter('minute'), obter('second'));
  const offsetMs = comoSeFosseUtcNoFuso - comoUtc;
  return new Date(comoUtc - offsetMs);
}

const diaSeguinteISO = (iso, n = -1) => {
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};
const diaSemanaDe = (iso) => {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay(); // 0=domingo ... 6=sábado, igual ao array DIAS do cliente
};

// Acha, a partir de `dataISO` andando para trás até `maxDias`, o primeiro dia que não está
// em dia_fechado e que tem pelo menos um período de expediente cadastrado.
async function diaUtilAnterior(sql, paroquiaId, dataISO, maxDias = 14) {
  let atual = dataISO;
  for (let i = 0; i < maxDias; i++) {
    const [fechado] = await sql`select 1 from dia_fechado where paroquia_id = ${paroquiaId} and data = ${atual}`;
    if (!fechado) {
      const periodos = await sql`
        select inicio, fim from expediente
        where paroquia_id = ${paroquiaId} and dia_semana = ${diaSemanaDe(atual)}
        order by fim desc
      `;
      if (periodos.length) return { data: atual, fimExpediente: periodos[0].fim };
    }
    atual = diaSeguinteISO(atual, -1);
  }
  return null;
}

// Retorna { inicioEnvio, prazo } (Date) ou null se não houver expediente cadastrado nos
// dias anteriores suficiente para calcular o prazo.
export async function calcularPrazo(sql, paroquiaId, dataCompromissoISO) {
  const [paroquia] = await sql`select fuso, horario_envio_confirmacao, antecedencia_confirmacao_min from paroquia where id = ${paroquiaId}`;
  if (!paroquia) return null;
  const fuso = paroquia.fuso || 'America/Sao_Paulo';
  const diaAnterior = diaSeguinteISO(dataCompromissoISO, -1);
  const util = await diaUtilAnterior(sql, paroquiaId, diaAnterior);
  if (!util) return null;
  const inicioEnvio = wallToUtc(diaAnterior, paroquia.horario_envio_confirmacao.slice(0, 5), fuso);
  const fimUtc = wallToUtc(util.data, String(util.fimExpediente).slice(0, 5), fuso);
  const prazo = new Date(fimUtc.getTime() - paroquia.antecedencia_confirmacao_min * 60 * 1000);
  return { inicioEnvio, prazo };
}

export async function buscarExpediente(sql, paroquiaId) {
  const [paroquia] = await sql`select antecedencia_confirmacao_min, horario_envio_confirmacao from paroquia where id = ${paroquiaId}`;
  const periodos = await sql`select dia_semana as "diaSemana", inicio, fim from expediente where paroquia_id = ${paroquiaId} order by dia_semana, inicio`;
  const fechados = await sql`select data, motivo from dia_fechado where paroquia_id = ${paroquiaId} order by data`;
  return {
    periodos: periodos.map((p) => ({ diaSemana: p.diaSemana, inicio: String(p.inicio).slice(0, 5), fim: String(p.fim).slice(0, 5) })),
    fechados: fechados.map((f) => ({ data: f.data, motivo: f.motivo })),
    antecedenciaMin: paroquia?.antecedencia_confirmacao_min ?? 30,
    horarioEnvio: paroquia ? String(paroquia.horario_envio_confirmacao).slice(0, 5) : '08:00',
  };
}

export async function salvarExpediente(sql, paroquiaId, { periodos, fechados, antecedenciaMin, horarioEnvio }) {
  await sql`update paroquia set antecedencia_confirmacao_min = ${antecedenciaMin}, horario_envio_confirmacao = ${horarioEnvio} where id = ${paroquiaId}`;
  await sql`delete from expediente where paroquia_id = ${paroquiaId}`;
  for (const p of periodos) {
    await sql`insert into expediente (paroquia_id, dia_semana, inicio, fim) values (${paroquiaId}, ${p.diaSemana}, ${p.inicio}, ${p.fim})`;
  }
  await sql`delete from dia_fechado where paroquia_id = ${paroquiaId}`;
  for (const f of fechados) {
    await sql`insert into dia_fechado (paroquia_id, data, motivo) values (${paroquiaId}, ${f.data}, ${f.motivo})`;
  }
}
