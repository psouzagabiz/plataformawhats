// Envio em massa segmentado e lembretes automáticos por data.
//
// Ambos reaproveitam a fila "saida" que o robô já consome (mesmo padrão de enviar/encerrar
// em api/principal.js) — nenhuma rota nova de entrega, só de enfileiramento.
import { banco } from './banco.js';

export async function enviarCampanha(sql, { paroquiaId, titulo, mensagem, grupos, criadoPor }) {
  const destinatarios = await sql`
    select telefone from conversa where paroquia_id = ${paroquiaId} and grupos && ${sql.array(grupos)}
  `;
  const [campanha] = await sql`
    insert into campanha (paroquia_id, titulo, mensagem, grupos, destinatarios, criado_por)
    values (${paroquiaId}, ${titulo}, ${mensagem}, ${sql.array(grupos)}, ${destinatarios.length}, ${criadoPor})
    returning id, titulo, mensagem, grupos, destinatarios, criado_em as "criadoEm"
  `;
  for (const d of destinatarios) {
    await sql`insert into saida (tipo, telefone, texto, autor, paroquia_id) values ('texto', ${d.telefone}, ${mensagem}, ${criadoPor}, ${paroquiaId})`;
  }
  return campanha;
}

// Chamada a cada minuto por api/rotina.js — cada regra só executa uma vez por dia
// (guardado por ultima_execucao_em), igual à lógica de confirmações em lib/confirmacao.js.
export async function executarRegrasAutomaticasHoje(origemSql) {
  const sql = origemSql || banco();
  const hoje = new Date();
  const hojeISO = hoje.toISOString().slice(0, 10);
  const diaDoMes = hoje.getDate();

  const regras = await sql`
    select id, paroquia_id as "paroquiaId", tipo, mensagem, dia_do_mes as "diaDoMes"
    from regra_automatica
    where ativa and (ultima_execucao_em is null or ultima_execucao_em::date <> current_date)
  `;

  let enfileiradas = 0;
  for (const r of regras) {
    let alvo = [];
    if (r.tipo === 'aniversario') {
      alvo = await sql`
        select telefone, nome from conversa
        where paroquia_id = ${r.paroquiaId} and aniversario is not null
          and to_char(aniversario, 'MM-DD') = to_char(current_date, 'MM-DD')
      `;
    } else if (r.diaDoMes === diaDoMes) {
      alvo = r.tipo === 'dizimo_mensal'
        ? await sql`select telefone, nome from conversa where paroquia_id = ${r.paroquiaId} and grupos && ${sql.array(['dizimistas'])}`
        : await sql`select telefone, nome from conversa where paroquia_id = ${r.paroquiaId}`;
    } else {
      continue; // dizimo_mensal/lembrete fora do dia configurado hoje
    }

    for (const p of alvo) {
      const texto = r.mensagem.replace('{nome}', String(p.nome || '').split(' ')[0] || 'tudo bem');
      await sql`insert into saida (tipo, telefone, texto, paroquia_id) values ('texto', ${p.telefone}, ${texto}, ${r.paroquiaId})`;
      enfileiradas++;
    }
    await sql`update regra_automatica set ultima_execucao_em = now() where id = ${r.id}`;
  }
  return { ok: true, enfileiradas, origem: hojeISO };
}
