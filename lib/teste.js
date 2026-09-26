// "Testar confirmação" (botão na tela Confirmações) — não mexe em compromissos reais.
// NOTA DE RECONSTRUÇÃO: ver o aviso no topo de lib/confirmacao.js — mesma situação aqui,
// reconstruído a partir do contrato observado em public/teste.js, não do código original.
import { calcularPrazo } from './agenda.js';
import { montarMensagemConfirmacao, OPCOES_RESPOSTA } from './confirmacao.js';
import { roboOnline } from './presenca.js';

export async function processarTeste(sql, eu, corpo) {
  const { numero, nome, data, hora, tipo, local, acao } = corpo;
  if (!numero || !data || !hora) return { erro: 'Preencha WhatsApp, data e horário.' };

  const calculo = await calcularPrazo(sql, eu.paroquiaId, data);
  if (!calculo) return { erro: 'Sem expediente cadastrado nos dias anteriores: não é possível calcular o prazo.' };

  const compromissoFalso = { tipo, data, hora, local, pessoa_nome: nome };
  const texto = montarMensagemConfirmacao(compromissoFalso);
  const base = { texto, inicioEnvio: calculo.inicioEnvio, prazo: calculo.prazo, respostas: OPCOES_RESPOSTA };

  if (acao !== 'enviar') return base;

  const [t] = await sql`
    insert into teste_confirmacao (paroquia_id, numero, criado_por)
    values (${eu.paroquiaId}, ${numero}, ${eu.nome})
    returning id
  `;
  await sql`insert into saida (tipo, numero, texto, referencia) values ('teste', ${numero}, ${texto}, ${'teste:' + t.id})`;

  return { ...base, naFila: true, roboOnline: await roboOnline(sql), id: t.id };
}

export async function consultarTeste(sql, id) {
  const [t] = await sql`select enviado_em as "enviadoEm", erro, resposta, respondido_em as "respondidoEm" from teste_confirmacao where id = ${id}`;
  return t || {};
}
