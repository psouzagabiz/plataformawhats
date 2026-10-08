// Envio em massa segmentado e lembretes automáticos por data.
//
// Ambos reaproveitam a fila "saida" que o robô já consome (mesmo padrão de enviar/encerrar
// em api/principal.js) — nenhuma rota nova de entrega, só de enfileiramento.
import { banco } from './banco.js';

// Insere em lotes (não um insert por linha) — enviar para centenas de destinatários fazia
// centenas de round-trips sequenciais ao banco antes desta mudança.
const LOTE = 500;
async function inserirSaidaEmLote(sql, linhas) {
  if (!linhas.length) return;
  const colunas = Object.keys(linhas[0]);
  for (let i = 0; i < linhas.length; i += LOTE) {
    const pedaco = linhas.slice(i, i + LOTE);
    await sql`insert into saida ${sql(pedaco, ...colunas)}`;
  }
}

export async function enviarCampanha(sql, { paroquiaId, titulo, mensagem, grupos, criadoPor }) {
  const destinatarios = await sql`
    select telefone from conversa where paroquia_id = ${paroquiaId} and grupos && ${sql.array(grupos)}
  `;
  const [campanha] = await sql`
    insert into campanha (paroquia_id, titulo, mensagem, grupos, destinatarios, criado_por)
    values (${paroquiaId}, ${titulo}, ${mensagem}, ${sql.array(grupos)}, ${destinatarios.length}, ${criadoPor})
    returning id, titulo, mensagem, grupos, destinatarios, criado_em as "criadoEm"
  `;
  await inserirSaidaEmLote(sql, destinatarios.map((d) => (
    { tipo: 'texto', telefone: d.telefone, texto: mensagem, autor: criadoPor, paroquia_id: paroquiaId }
  )));
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

    const linhasSaida = alvo.map((p) => ({
      tipo: 'texto',
      telefone: p.telefone,
      texto: r.mensagem.replace('{nome}', String(p.nome || '').split(' ')[0] || 'tudo bem'),
      paroquia_id: r.paroquiaId,
    }));
    await inserirSaidaEmLote(sql, linhasSaida);
    enfileiradas += linhasSaida.length;
    await sql`update regra_automatica set ultima_execucao_em = now() where id = ${r.id}`;
  }
  return { ok: true, enfileiradas, origem: hojeISO };
}
