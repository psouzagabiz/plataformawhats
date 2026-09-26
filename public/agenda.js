/* Agenda, confirmações e configurações. Usa as funções de app.js ($, api, el, toast, confirmar, estado). */
(() => {
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
let opcoes = null;
const ag = { visao: 'semana', ref: hojeISO(), modo: 'lista' }; // modo: 'lista' | 'calendario'
const cfPagina = { atual: 1, porPagina: 20 };
const cf = { status: '' };

/* ---------------- datas ---------------- */
function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const paraData = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); };
const paraISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const somar = (iso, dias) => { const d = paraData(iso); d.setDate(d.getDate() + dias); return paraISO(d); };
const dataBR = (iso) => iso.split('-').reverse().join('/');
const quando = (ts) => ts ? new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

function intervalo() {
  if (ag.modo === 'calendario') {
    // semanas completas (segunda a domingo) que cobrem o mês
    const d = paraData(ag.ref);
    const inicio = paraISO(new Date(d.getFullYear(), d.getMonth(), 1));
    const fim = paraISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    return [somar(inicio, -((paraData(inicio).getDay() + 6) % 7)), somar(fim, (7 - paraData(fim).getDay()) % 7)];
  }
  if (ag.visao === 'dia') return [ag.ref, ag.ref];
  if (ag.visao === 'semana') {
    const d = paraData(ag.ref);
    const seg = somar(ag.ref, -((d.getDay() + 6) % 7));
    return [seg, somar(seg, 6)];
  }
  const d = paraData(ag.ref);
  return [paraISO(new Date(d.getFullYear(), d.getMonth(), 1)), paraISO(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
}

async function carregarOpcoes(forcar = false) {
  if (opcoes && !forcar) return opcoes;
  opcoes = await api('agenda/opcoes');
  const preencher = (sel, itens, primeiro) => {
    const atual = sel.value;
    sel.replaceChildren(...(primeiro ? [el('option', { value: primeiro[0], texto: primeiro[1] })] : []),
      ...itens.map(([v, t]) => el('option', { value: v, texto: t })));
    sel.value = atual || sel.value;
  };
  const padres = opcoes.padres.filter((p) => p.ativo).map((p) => [p.id, p.nome]);
  const tipos = Object.entries(opcoes.tipos);
  preencher($('agPadre'), padres, ['', 'Todos os padres']);
  preencher($('cfPadre'), padres, ['', 'Todos os padres']);
  preencher($('cpPadre'), padres, ['', 'Sem padre definido']);
  preencher($('agTipo'), tipos, ['', 'Todos os tipos']);
  preencher($('cfTipo'), tipos, ['', 'Todos os tipos']);
  preencher($('cpTipo'), tipos);
  preencher($('agStatus'), Object.entries(opcoes.status), ['ativos', 'Somente ativos']);
  if (![...$('agStatus').options].some((o) => o.value === '')) $('agStatus').append(el('option', { value: '', texto: 'Todas as situações' }));
  preencher($('cfStatus'), Object.entries(opcoes.status), ['', 'Todas as situações']);
  return opcoes;
}

const etiqueta = (status) => el('span', { class: `situacao s-${status}`, texto: opcoes?.status[status] || status });

/* =================== AGENDA =================== */
async function carregarAgenda() {
  await carregarOpcoes();
  const [de, ate] = intervalo();
  const titulo = ag.modo === 'calendario' || ag.visao === 'mes'
    ? paraData(ag.ref).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    : ag.visao === 'dia'
      ? paraData(ag.ref).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
      : `${dataBR(de).slice(0, 5)} a ${dataBR(ate)}`;
  $('agTitulo').textContent = titulo;
  $('agLegenda').replaceChildren(...Object.entries(opcoes.tipos).map(([id, nome]) => el('span', { class: `t-${id}`, texto: nome })));
  const caixa = $('agLista');
  caixa.setAttribute('aria-busy', 'true');
  caixa.replaceChildren(...[1, 2, 3].map(() => el('div', { class: 'esqueleto linha-alta', style: 'height:62px' })));
  let lista;
  try {
    lista = await api(`compromissos?${new URLSearchParams({ de, ate, padre: $('agPadre').value, tipo: $('agTipo').value, status: $('agStatus').value })}`);
  } catch (e) {
    caixa.replaceChildren(el('div', { class: 'vazio' }, [el('p', {}, el('strong', { texto: 'Não foi possível carregar a agenda' })), el('p', { class: 'pequeno', texto: `${e.message}. Confira a internet e tente de novo.` }),
      el('button', { type: 'button', class: 'secundario', texto: 'Tentar de novo', onclick: carregarAgenda })]));
    return;
  } finally { caixa.removeAttribute('aria-busy'); }
  if (ag.modo === 'calendario') { desenharCalendario(caixa, lista, de, ate); return; }
  caixa.replaceChildren();
  if (!lista.length) {
    caixa.append(vazio('Nenhum compromisso neste período', 'Mude o período ou os filtros, ou cadastre um compromisso novo.',
      { texto: 'Novo compromisso', icone: 'mais', onclick: () => $('btnNovoCompromisso').click() }));
    return;
  }
  const porDia = new Map();
  for (const c of lista) porDia.set(c.data, [...(porDia.get(c.data) || []), c]);
  const hoje = hojeISO();
  for (const [dia, itens] of porDia) {
    const nomeDia = paraData(dia).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
    caixa.append(el('div', { class: `agenda-dia${dia === hoje ? ' hoje' : ''}` }, [
      el('h3', { texto: dia === hoje ? `Hoje, ${nomeDia}` : nomeDia }),
      ...itens.map(cartaoCompromisso),
    ]));
  }
}

// mês em grade de 7 colunas; cada compromisso com a cor do seu tipo
function desenharCalendario(caixa, lista, de, ate) {
  const hoje = hojeISO();
  const mes = paraData(ag.ref).getMonth();
  const porDia = new Map();
  for (const c of lista) porDia.set(c.data, [...(porDia.get(c.data) || []), c]);
  const dias = [];
  for (let d = de; d <= ate; d = somar(d, 1)) dias.push(d);
  const MAX = 3;
  caixa.replaceChildren(el('div', { class: 'calendario', role: 'grid', 'aria-label': $('agTitulo').textContent }, [
    el('div', { class: 'cal-semana', role: 'row' }, ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((n) => el('div', { role: 'columnheader', texto: n }))),
    el('div', { class: 'cal-grade' }, dias.map((d) => {
      const itens = porDia.get(d) || [];
      const nome = paraData(d).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
      return el('div', {
        class: `cal-dia${paraData(d).getMonth() !== mes ? ' fora' : ''}${d === hoje ? ' hoje' : ''}`, role: 'gridcell',
        'aria-label': `${nome}: ${itens.length ? `${itens.length} compromisso(s)` : 'sem compromissos'}`,
      }, [
        el('span', { class: 'cal-num', texto: String(paraData(d).getDate()) }),
        ...itens.slice(0, MAX).map((c) => el('button', {
          type: 'button', class: `cal-evento t-${c.tipo}${opcoes.ativos.includes(c.status) ? '' : ' inativo'}`,
          title: `${c.hora} ${opcoes.tipos[c.tipo]}${c.pessoaNome ? ', ' + c.pessoaNome : ''} (${opcoes.status[c.status] || c.status})`,
          'aria-label': `${c.hora}, ${opcoes.tipos[c.tipo]}${c.pessoaNome ? ', ' + c.pessoaNome : ''}. ${opcoes.status[c.status] || c.status}`,
          texto: `${c.hora} ${c.pessoaNome || opcoes.tipos[c.tipo]}`, onclick: () => abrirDetalhe(c.id),
        })),
        itens.length > MAX ? el('button', { type: 'button', class: 'cal-mais', texto: `mais ${itens.length - MAX}`, onclick: () => {
          ag.modo = 'lista'; ag.visao = 'dia'; ag.ref = d; $('agVisao').value = 'dia'; atualizarModo(); carregarAgenda();
        } }) : null,
      ]);
    })),
  ]));
}

function cartaoCompromisso(c) {
  const ativo = opcoes.ativos.includes(c.status);
  return el('button', { type: 'button', class: `compromisso t-${c.tipo} b-${c.status}${ativo ? '' : ' inativo'}`, onclick: () => abrirDetalhe(c.id) }, [
    el('span', { class: 'hora', texto: c.hora }),
    el('span', { class: 'quem', texto: c.pessoaNome || 'Sem pessoa informada' }),
    c.ultimoErro && c.status === 'agendado' ? el('span', { class: 'situacao s-erro', texto: 'Requer atenção' }) : etiqueta(c.status),
    el('span', { class: 'extra', texto: [opcoes.tipos[c.tipo], c.padreNome, c.local || c.endereco].filter(Boolean).join(', ') }),
  ]);
}

function atualizarModo() {
  const cal = ag.modo === 'calendario';
  $('agModoLista').classList.toggle('ativo', !cal);
  $('agModoCalendario').classList.toggle('ativo', cal);
  $('agModoLista').setAttribute('aria-pressed', String(!cal));
  $('agModoCalendario').setAttribute('aria-pressed', String(cal));
  $('agVisao').hidden = cal; // o calendário sempre mostra o mês
}
$('agModoLista').addEventListener('click', () => { ag.modo = 'lista'; atualizarModo(); carregarAgenda(); });
$('agModoCalendario').addEventListener('click', () => { ag.modo = 'calendario'; atualizarModo(); carregarAgenda(); });
$('agAnterior').addEventListener('click', () => { ag.ref = passo(-1); carregarAgenda(); });
$('agProximo').addEventListener('click', () => { ag.ref = passo(1); carregarAgenda(); });
$('agHoje').addEventListener('click', () => { ag.ref = hojeISO(); carregarAgenda(); });
$('agVisao').addEventListener('change', () => { ag.visao = $('agVisao').value; carregarAgenda(); });
['agPadre', 'agTipo', 'agStatus'].forEach((id) => $(id).addEventListener('change', carregarAgenda));
function passo(n) {
  if (ag.modo === 'calendario') { const d = paraData(ag.ref); return paraISO(new Date(d.getFullYear(), d.getMonth() + n, 1)); }
  if (ag.visao === 'dia') return somar(ag.ref, n);
  if (ag.visao === 'semana') return somar(ag.ref, 7 * n);
  const d = paraData(ag.ref);
  return paraISO(new Date(d.getFullYear(), d.getMonth() + n, 1));
}

/* ---------------- novo / editar ---------------- */
$('btnNovoCompromisso').addEventListener('click', async () => {
  await carregarOpcoes();
  abrirFormulario(null);
});

function abrirFormulario(c) {
  $('cpTitulo').textContent = c ? 'Editar compromisso' : 'Novo compromisso';
  $('cpId').value = c?.id || '';
  $('cpTipo').value = c?.tipo || 'direcao';
  $('cpPadre').value = c?.padreId || '';
  $('cpData').value = c?.data || (ag.visao === 'dia' ? ag.ref : somar(hojeISO(), 1));
  $('cpHora').value = c?.hora || '';
  $('cpPessoa').value = c?.pessoaNome || '';
  $('cpWhatsapp').value = c?.pessoaWhatsapp || '';
  $('cpLocal').value = c?.local || '';
  $('cpEndereco').value = c?.endereco || '';
  $('cpObs').value = c?.observacoes || '';
  $('cpConfirmacao').checked = c ? c.exigeConfirmacao : true;
  $('cpErro').hidden = true;
  mostrarPrazo();
  $('dlgCompromisso').showModal();
}

async function mostrarPrazo() {
  const p = $('cpPrazo');
  if (!$('cpConfirmacao').checked || !$('cpData').value) { p.textContent = ''; return; }
  try {
    const r = await api(`expediente/simular?data=${$('cpData').value}`);
    p.textContent = r.prazo
      ? `A mensagem será enviada em ${quando(r.inicioEnvio)} e a pessoa terá até ${quando(r.prazo)} para confirmar. Sem confirmação, o compromisso é desmarcado automaticamente.`
      : 'Atenção: o expediente da secretaria ainda não foi cadastrado (Configurações), então não será possível calcular o prazo.';
  } catch { p.textContent = ''; }
}
$('cpData').addEventListener('change', mostrarPrazo);
$('cpConfirmacao').addEventListener('change', mostrarPrazo);

$('formCompromisso').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'ok') return;
  e.preventDefault();
  const id = $('cpId').value;
  const dados = {
    id: id ? Number(id) : undefined,
    tipo: $('cpTipo').value, padreId: $('cpPadre').value || null, data: $('cpData').value, hora: $('cpHora').value,
    pessoaNome: $('cpPessoa').value, pessoaWhatsapp: $('cpWhatsapp').value, local: $('cpLocal').value,
    endereco: $('cpEndereco').value, observacoes: $('cpObs').value, exigeConfirmacao: $('cpConfirmacao').checked,
  };
  $('cpSalvar').disabled = true;
  try {
    await api('compromissos', { metodo: id ? 'PUT' : 'POST', corpo: dados });
    $('dlgCompromisso').close();
    toast(id ? 'Compromisso atualizado.' : 'Compromisso cadastrado.', 'sucesso');
    ag.ref = dados.data;
    carregarAgenda();
    if (estado.vista === 'confirmacoes') carregarConfirmacoes();
  } catch (err) {
    $('cpErro').textContent = err.message;
    $('cpErro').hidden = false;
  } finally {
    $('cpSalvar').disabled = false;
  }
});

/* ---------------- detalhe + histórico ---------------- */
const ACOES_HISTORICO = {
  criado: 'Criado', editado: 'Editado', data_alterada: 'Data/horário alterados', confirmacao_enviada: 'Confirmação enviada',
  erro_envio: 'Erro no envio', prazo_sem_envio: 'Prazo encerrado sem envio', confirmado_pela_pessoa: 'Presença confirmada',
  alteracao_solicitada: 'Alteração solicitada', cancelado_pela_pessoa: 'Cancelado pela pessoa',
  cancelado_pela_secretaria: 'Cancelado pela secretaria', desmarcado_automaticamente: 'Desmarcado automaticamente',
  marcado_realizado: 'Realizado', confirmacao_fora_do_prazo: 'Tentou confirmar após o prazo', resposta_ignorada: 'Resposta após encerramento',
};

async function abrirDetalhe(id) {
  await carregarOpcoes();
  let d;
  try { d = await api(`compromissos/historico?id=${id}`); } catch (e) { toast(e.message, 'erro'); return; }
  const c = d.compromisso;
  const ativo = opcoes.ativos.includes(c.status);
  const linha = (rotulo, valor) => valor ? [el('dt', { texto: rotulo }), el('dd', { texto: valor })] : [];
  $('dtConteudo').replaceChildren(
    el('div', { class: 'detalhe-cabeca' }, [
      el('div', {}, [
        el('h2', { style: 'margin:0', texto: opcoes.tipos[c.tipo] }),
        el('p', { class: 'suave', style: 'margin:2px 0 0', texto: `${paraData(c.data).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })} às ${c.hora}` }),
      ]),
      etiqueta(c.status),
    ]),
    c.ultimoErro ? el('div', { class: 'aviso-caixa' }, [icone('alerta'), el('span', { texto: c.ultimoErro })]) : null,
    el('dl', { class: 'detalhe-linhas' }, [
      ...linha('Pessoa', c.pessoaNome), ...linha('WhatsApp', c.pessoaWhatsapp), ...linha('Padre', c.padreNome),
      ...linha('Local', c.local), ...linha('Endereço', c.endereco), ...linha('Observações', c.observacoes),
      ...linha('Confirmação', c.exigeConfirmacao ? 'Exigida' : 'Não exigida'),
      ...linha('Prazo para confirmar', c.prazoConfirmacao && quando(c.prazoConfirmacao)),
      ...linha('Mensagem enviada', c.confirmacaoEnviadaEm && quando(c.confirmacaoEnviadaEm)),
      ...linha('Resposta', c.respondidoEm && quando(c.respondidoEm)),
      ...linha('Desmarcado em', c.desmarcadoEm && quando(c.desmarcadoEm)),
      ...linha('Criado por', c.criadoPor && `${c.criadoPor} em ${quando(c.criadoEm)}`),
    ]),
    el('h3', { class: 'secao-textos', texto: 'Histórico' }),
    el('ol', { class: 'historico' }, d.historico.map((h) => el('li', {}, [
      el('time', { texto: `${quando(h.criadoEm)} · ${h.feitoPor}` }), el('br'),
      el('strong', { texto: ACOES_HISTORICO[h.acao] || h.acao }), h.detalhe ? ` — ${h.detalhe}` : '',
    ]))),
  );
  const fechar = () => $('dlgDetalhe').close();
  $('dtBotoes').replaceChildren(
    el('button', { class: 'secundario', type: 'button', texto: 'Fechar', onclick: fechar }),
    ativo ? el('button', { class: 'secundario', type: 'button', texto: 'Marcar como realizado', onclick: () => acao('realizado', c, 'Marcar como realizado?') }) : null,
    ativo ? el('button', { class: 'aviso', type: 'button', texto: 'Cancelar compromisso', onclick: () => acao('cancelar', c, 'Cancelar este compromisso?') }) : null,
    ativo ? el('button', { class: 'primario', type: 'button', texto: 'Editar', onclick: () => { fechar(); abrirFormulario(c); } }) : null,
  );
  $('dlgDetalhe').showModal();
}

async function acao(qual, c, pergunta) {
  $('dlgDetalhe').close();
  if (!(await confirmar(pergunta, `${opcoes.tipos[c.tipo]} de ${dataBR(c.data)} às ${c.hora}. O compromisso continua no histórico.`, 'Confirmar'))) return;
  try {
    await api(`compromissos/${qual}`, { metodo: 'POST', corpo: { id: c.id } });
    toast(qual === 'cancelar' ? 'Compromisso cancelado.' : 'Marcado como realizado.', 'sucesso');
    carregarAgenda();
    if (estado.vista === 'confirmacoes') carregarConfirmacoes();
  } catch (e) { toast(e.message, 'erro'); }
}

/* =================== CONFIRMAÇÕES =================== */
const CARTOES = [
  ['aguardando_confirmacao', 'Aguardando confirmação'], ['confirmado', 'Confirmados'],
  ['alteracao_solicitada', 'Alteração solicitada'], ['cancelado_pela_pessoa', 'Cancelados pela pessoa'],
  ['desmarcado_sem_confirmacao', 'Desmarcados automaticamente'], ['erro', 'Com erro ou atenção'],
  ['agendado', 'Ainda não enviados'],
];

async function carregarConfirmacoes() {
  await carregarOpcoes();
  if (!$('cfDe').value) { $('cfDe').value = somar(hojeISO(), -7); $('cfAte').value = somar(hojeISO(), 30); }
  const filtro = { de: $('cfDe').value, ate: $('cfAte').value };
  let resumo;
  try { resumo = await api(`confirmacoes/resumo?${new URLSearchParams(filtro)}`); } catch (e) { toast(e.message, 'erro'); return; }

  $('cfAviso').replaceChildren(resumo.roboOnline ? '' : el('div', { class: 'aviso-caixa' }, [icone('alerta'), el('span', {}, [
    el('strong', { texto: 'Robô desconectado. ' }),
    'As mensagens de confirmação só são enviadas enquanto o computador da paróquia estiver ligado. Se ele não voltar antes do prazo, o compromisso não é desmarcado e fica marcado para a secretaria verificar.',
  ])]));

  $('cfCartoes').replaceChildren(...CARTOES.map(([id, rotulo]) => {
    const n = id === 'erro' ? resumo.errosEnvio : (resumo.porStatus[id] || 0);
    return el('button', {
      type: 'button', class: `cartao-resumo r-${id}${cf.status === id ? ' ativo' : ''}`, 'aria-pressed': String(cf.status === id),
      onclick: () => { cf.status = cf.status === id ? '' : id; $('cfStatus').value = id === 'erro' ? '' : cf.status; cfPagina.atual = 1; carregarConfirmacoes(); },
    }, [el('span', { class: 'numero', texto: String(n) }), el('span', { class: 'rotulo', texto: rotulo })]);
  }));

  const params = new URLSearchParams({ ...filtro, confirmacao: '1', padre: $('cfPadre').value, tipo: $('cfTipo').value });
  if (cf.status === 'erro') params.set('erro', '1');
  else if ($('cfStatus').value || cf.status) params.set('status', $('cfStatus').value || cf.status);
  const tabela = $('cfTabela');
  const cabeca = el('thead', {}, el('tr', {}, ['Compromisso', 'Pessoa', 'Padre', 'Prazo para confirmar', 'Situação'].map((t) => el('th', { scope: 'col', texto: t }))));
  tabela.setAttribute('aria-busy', 'true');
  tabela.replaceChildren(cabeca, el('tbody', {}, [1, 2, 3, 4].map(() => el('tr', {}, [1, 2, 3, 4, 5].map(() => el('td', {}, el('span', { class: 'esqueleto linha', style: 'margin:4px 0' })))))));
  let lista = [];
  try { lista = await api(`compromissos?${params}`); } catch (e) { toast(e.message, 'erro'); }
  tabela.removeAttribute('aria-busy');

  // paginação no navegador (20 por página)
  const paginas = Math.max(1, Math.ceil(lista.length / cfPagina.porPagina));
  cfPagina.atual = Math.min(cfPagina.atual, paginas);
  const inicio = (cfPagina.atual - 1) * cfPagina.porPagina;
  const pagina = lista.slice(inicio, inicio + cfPagina.porPagina);
  tabela.replaceChildren(
    cabeca,
    el('tbody', {}, pagina.length ? pagina.map((c) => el('tr', {
      tabindex: '0', 'aria-label': `Abrir ${opcoes.tipos[c.tipo]} de ${dataBR(c.data)} às ${c.hora}`,
      onclick: () => abrirDetalhe(c.id), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirDetalhe(c.id); } },
    }, [
      el('td', {}, [el('strong', { texto: `${dataBR(c.data)} às ${c.hora}` }), el('br'), el('span', { class: 'suave', texto: opcoes.tipos[c.tipo] })]),
      el('td', { texto: c.pessoaNome || 'Não informada' }),
      el('td', { texto: c.padreNome || 'Não definido' }),
      el('td', { texto: c.prazoConfirmacao ? quando(c.prazoConfirmacao) : 'Ainda não calculado' }),
      el('td', {}, [etiqueta(c.status), c.ultimoErro && c.status === 'agendado' ? el('div', { class: 'erro-envio', texto: c.ultimoErro }) : null]),
    ])) : [el('tr', {}, el('td', { colspan: '5', class: 'vazio-tabela' },
      vazio('Nenhum compromisso encontrado', 'Mude o período ou os filtros. Só aparecem compromissos que pedem confirmação de presença.')))]),
  );
  $('cfPaginacao').replaceChildren(...(lista.length > cfPagina.porPagina ? [
    el('span', { texto: `Mostrando ${inicio + 1} a ${inicio + pagina.length} de ${lista.length}` }),
    el('div', { class: 'grupo' }, [
      el('button', { type: 'button', class: 'secundario pequeno-botao', disabled: cfPagina.atual === 1 ? '' : null,
        onclick: () => { cfPagina.atual--; carregarConfirmacoes(); } }, [icone('esquerda'), 'Anterior']),
      el('button', { type: 'button', class: 'secundario pequeno-botao', disabled: cfPagina.atual === paginas ? '' : null,
        onclick: () => { cfPagina.atual++; carregarConfirmacoes(); } }, ['Próxima', icone('direita')]),
    ]),
  ] : lista.length ? [el('span', { texto: `${lista.length} compromisso(s)` })] : []));
  const r = resumo.ultimaRotina;
  $('cfRotina').textContent = r
    ? `Última verificação automática: ${quando(r.em)} (enviadas ao robô: ${r.enviados}, desmarcados: ${r.desmarcados}, erros: ${r.erros}).`
    : 'A verificação automática ainda não rodou.';
}
['cfDe', 'cfAte', 'cfPadre', 'cfTipo'].forEach((id) => $(id).addEventListener('change', () => { cfPagina.atual = 1; carregarConfirmacoes(); }));
$('cfStatus').addEventListener('change', () => { cf.status = $('cfStatus').value; cfPagina.atual = 1; carregarConfirmacoes(); });

/* =================== CONFIGURAÇÕES =================== */
let expediente = { periodos: [], fechados: [], antecedenciaMin: 30 };

async function carregarConfiguracoes() {
  await carregarOpcoes(true);
  try { expediente = await api('expediente'); } catch (e) { toast(e.message, 'erro'); return; }
  desenharExpediente();
  desenharPadres();
  desenharWhatsapp();
}

function desenharExpediente() {
  $('cfgAntecedencia').value = expediente.antecedenciaMin;
  $('cfgHorarioEnvio').value = expediente.horarioEnvio || '08:00';
  $('cfgRegra').textContent = `mensagem enviada às ${expediente.horarioEnvio || '08:00'} do dia anterior; prazo de ${expediente.antecedenciaMin} minutos antes do fim do expediente desse dia`;
  const caixa = $('cfgExpediente');
  caixa.replaceChildren(...DIAS.map((nome, dia) => {
    const periodos = expediente.periodos.filter((p) => p.diaSemana === dia);
    return el('div', { class: 'expediente-dia' }, [
      el('strong', { texto: nome }),
      el('div', { class: 'periodos' }, [
        ...(periodos.length ? periodos.map((p) => el('span', { class: 'periodos' }, [
          campoHora(p, 'inicio'), 'às', campoHora(p, 'fim'),
          el('button', { type: 'button', class: 'botao-icone mini', title: 'Remover período', 'aria-label': 'Remover período', onclick: () => {
            expediente.periodos = expediente.periodos.filter((x) => x !== p); desenharExpediente();
          } }, icone('fechar')),
        ])) : [el('span', { class: 'suave pequeno', texto: 'Fechado' })]),
        el('button', { type: 'button', class: 'link pequeno', onclick: () => {
          expediente.periodos.push({ diaSemana: dia, inicio: '', fim: '' }); desenharExpediente();
        } }, [icone('mais'), 'Período']),
      ]),
    ]);
  }));
  $('cfgFechados').replaceChildren(...expediente.fechados.map((f) => el('div', { class: 'periodos', style: 'margin-bottom:6px' }, [
    Object.assign(el('input', { type: 'date', style: 'width:auto' }), { value: f.data, oninput: (e) => { f.data = e.target.value; } }),
    Object.assign(el('input', { placeholder: 'Motivo (ex.: feriado)', maxlength: '80', style: 'width:auto;flex:1' }), { value: f.motivo, oninput: (e) => { f.motivo = e.target.value; } }),
    el('button', { type: 'button', class: 'botao-icone', title: 'Remover', 'aria-label': 'Remover', onclick: () => { expediente.fechados = expediente.fechados.filter((x) => x !== f); desenharExpediente(); } }, icone('fechar')),
  ])));
}
function campoHora(p, campo) {
  return Object.assign(el('input', { type: 'time', required: '' }), { value: p[campo], oninput: (e) => { p[campo] = e.target.value; } });
}
$('cfgAddFechado').addEventListener('click', () => { expediente.fechados.push({ data: '', motivo: '' }); desenharExpediente(); });
$('cfgSalvarExpediente').addEventListener('click', async () => {
  try {
    await api('expediente', { metodo: 'PUT', corpo: {
      periodos: expediente.periodos.filter((p) => p.inicio && p.fim),
      fechados: expediente.fechados.filter((f) => f.data),
      antecedenciaMin: Number($('cfgAntecedencia').value),
      horarioEnvio: $('cfgHorarioEnvio').value || '08:00',
    } });
    toast('Expediente salvo. Os prazos de confirmação foram recalculados.', 'sucesso');
    carregarConfiguracoes();
  } catch (e) { toast(e.message, 'erro'); }
});
$('cfgSimular').addEventListener('change', async () => {
  const data = $('cfgSimular').value;
  if (!data) return;
  const r = await api(`expediente/simular?data=${data}`).catch((e) => ({ erro: e.message }));
  $('cfgSimulacao').textContent = r.erro || (r.prazo
    ? `Para um compromisso em ${dataBR(data)}: mensagem enviada a partir de ${quando(r.inicioEnvio)}; prazo para confirmar até ${quando(r.prazo)}.`
    : 'Sem expediente cadastrado nos dias anteriores: não é possível calcular o prazo.');
});

function desenharPadres() {
  const caixa = $('cfgPadres');
  caixa.replaceChildren(
    ...(opcoes.padres.length ? opcoes.padres.map((p) => el('div', { class: 'linha-padre' }, [
      el('span', {}, [avatar(p.nome), el('span', {}, [el('strong', { texto: p.nome }), el('br'),
        el('span', { class: 'suave pequeno', texto: `${p.whatsapp || 'sem WhatsApp'}${p.ativo ? '' : ' · inativo'}` })])]),
      el('button', { type: 'button', class: 'secundario pequeno-botao', texto: 'Editar', onclick: () => abrirPadre(p) }),
    ])) : [el('p', { class: 'suave', texto: 'Nenhum padre cadastrado.' })]),
    el('button', { type: 'button', class: 'link', style: 'margin-top:10px', onclick: () => abrirPadre(null) }, [icone('mais'), 'Cadastrar padre']),
  );
}
function abrirPadre(p) {
  $('pdTitulo').textContent = p ? 'Editar padre' : 'Cadastrar padre';
  $('pdId').value = p?.id || '';
  $('pdNome').value = p?.nome || '';
  $('pdWhatsapp').value = p?.whatsapp || '';
  $('pdAtivo').checked = p ? p.ativo : true;
  $('pdErro').hidden = true;
  $('dlgPadre').showModal();
}
$('formPadre').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'ok') return;
  e.preventDefault();
  const id = $('pdId').value;
  try {
    await api('padres', { metodo: id ? 'PUT' : 'POST', corpo: { id: Number(id) || undefined, nome: $('pdNome').value, whatsapp: $('pdWhatsapp').value, ativo: $('pdAtivo').checked } });
    $('dlgPadre').close();
    toast('Padre salvo.', 'sucesso');
    await carregarOpcoes(true);
    desenharPadres();
  } catch (err) { $('pdErro').textContent = err.message; $('pdErro').hidden = false; }
});

function desenharWhatsapp() {
  const exemplo = el('div', { class: 'modelo' });
  formatarWhats(opcoes.exemploMensagem, exemplo);
  $('cfgWhatsapp').replaceChildren(
    el('div', { class: opcoes.roboOnline ? 'ok-caixa' : 'aviso-caixa' }, [
      icone(opcoes.roboOnline ? 'confirma' : 'alerta'),
      el('span', {}, [el('strong', { texto: opcoes.roboOnline ? 'Robô conectado. ' : 'Robô desconectado. ' }),
        'As mensagens de confirmação são enviadas pelo próprio robô, no WhatsApp da paróquia. A pessoa responde com o número da opção (1, 2 ou 3), por texto ou áudio, e a resposta aparece aqui.']),
    ]),
    el('p', { class: 'suave pequeno', style: 'margin:16px 0 0', texto: 'Exemplo da mensagem que a pessoa recebe:' }),
    el('div', { class: 'fundo-chat' }, exemplo),
  );
}

/* ---------------- troca de seção ---------------- */
document.addEventListener('vista', (e) => {
  const v = e.detail;
  if (v === 'agenda') carregarAgenda().catch((err) => toast(err.message, 'erro'));
  if (v === 'confirmacoes') carregarConfirmacoes().catch((err) => toast(err.message, 'erro'));
  if (v === 'configuracoes') carregarConfiguracoes().catch((err) => toast(err.message, 'erro'));
});
})();
