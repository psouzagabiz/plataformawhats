// Agenda diária automática enviada ao padre pelo WhatsApp, pela fila "saida" que o robô já
// consome (mesmo padrão de lib/campanhas.js). Dispara uma vez por dia, no horário local de
// cada paróquia, para cada padre ativo com WhatsApp cadastrado — sem depender do painel.
// Idempotência por padre.ultima_agenda_enviada_em, igual a regra_automatica.ultima_execucao_em
// em lib/campanhas.js.
import { banco } from './banco.js';
import { TIPOS, STATUS, wallToUtc } from './agenda.js';

const HORA_ENVIO = '07:00';

function montarMensagem(compromissos) {
  if (!compromissos.length) return '📅 Agenda de hoje\n\nNenhum compromisso agendado para hoje. 🙏';
  const linhas = compromissos.map((c) => {
    const hora = String(c.hora).slice(0, 5);
    const tipo = TIPOS[c.tipo] || c.tipo;
    const pessoa = c.pessoa_nome || 'sem nome';
    const status = STATUS[c.status] || c.status;
    return `${hora} — ${tipo}, ${pessoa} (${status})`;
  });
  return `📅 Agenda de hoje\n\n${linhas.join('\n')}`;
}

// Chamada a cada minuto por api/rotina.js, igual a executarRegrasAutomaticasHoje.
export async function enviarAgendaDiariaPadres(origemSql) {
  const sql = origemSql || banco();

  const padres = await sql`
    select p.id, p.whatsapp, p.paroquia_id as "paroquiaId", pa.fuso
    from padre p
    join paroquia pa on pa.id = p.paroquia_id
    where p.ativo and p.whatsapp <> ''
      and (p.ultima_agenda_enviada_em is null or p.ultima_agenda_enviada_em <> current_date)
  `;

  let enfileiradas = 0;
  for (const padre of padres) {
    const fuso = padre.fuso || 'America/Sao_Paulo';
    const hojeNoFuso = new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(new Date());
    const horarioEnvioUtc = wallToUtc(hojeNoFuso, HORA_ENVIO, fuso);
    if (new Date() < horarioEnvioUtc) continue; // ainda não deu a hora de envio nesse fuso

    const compromissos = await sql`
      select tipo, hora, pessoa_nome, status from compromisso
      where padre_id = ${padre.id} and data = ${hojeNoFuso}
        and status not in ('cancelado', 'cancelado_pela_pessoa', 'desmarcado_sem_confirmacao')
      order by hora
    `;

    await sql`
      insert into saida (tipo, telefone, texto, paroquia_id, referencia)
      values ('texto', ${padre.whatsapp}, ${montarMensagem(compromissos)}, ${padre.paroquiaId}, 'agenda_diaria_padre')
    `;
    await sql`update padre set ultima_agenda_enviada_em = ${hojeNoFuso} where id = ${padre.id}`;
    enfileiradas += 1;
  }
  return { ok: true, enfileiradas };
}
