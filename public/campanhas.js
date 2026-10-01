/* Campanhas (envio em massa segmentado) e Lembretes automáticos (disparo por data).
Usa as funções de app.js ($, api, el, toast, vazio). */
(() => {
const GRUPOS = { dizimistas: 'Dizimistas', catequese: 'Catequese', pastoral: 'Pastorais' };
const gruposEscolhidos = new Set();

/* ---------- Campanhas ---------- */
function desenharChipsGrupo() {
  const caixa = $('campGrupos');
  caixa.replaceChildren(...Object.entries(GRUPOS).map(([valor, rotulo]) =>
    el('button', {
      type: 'button', class: `chip-grupo${gruposEscolhidos.has(valor) ? ' ativo' : ''}`, texto: rotulo,
      onclick: () => { gruposEscolhidos.has(valor) ? gruposEscolhidos.delete(valor) : gruposEscolhidos.add(valor); desenharChipsGrupo(); },
    })
  ));
}
desenharChipsGrupo();

async function carregarCampanhas() {
  const caixa = $('listaCampanhas');
  caixa.replaceChildren(el('div', { class: 'esqueleto cartao-esq baixo' }));
  let lista;
  try { lista = await api('campanhas'); } catch (err) { caixa.replaceChildren(el('p', { class: 'erro', texto: err.message })); return; }
  if (!lista.length) { caixa.replaceChildren(vazio('Nenhuma campanha enviada ainda.')); return; }
  caixa.replaceChildren(...lista.map((c) => el('div', { class: 'cartao-lista' }, [
    el('div', { class: 'linha' }, [
      el('strong', { texto: c.titulo }),
      el('span', { class: 'suave pequeno', texto: new Date(c.criadoEm).toLocaleString('pt-BR') }),
    ]),
    el('p', { class: 'suave', texto: c.mensagem }),
    el('p', { class: 'suave pequeno', texto: `${c.grupos.map((g) => GRUPOS[g] || g).join(', ')} · ${c.destinatarios} destinatário${c.destinatarios === 1 ? '' : 's'}` }),
  ])));
}

$('btnDispararCampanha').addEventListener('click', async () => {
  if (!$('formCampanha').reportValidity()) return;
  if (!gruposEscolhidos.size) return toast('Escolha pelo menos um grupo.', 'erro');
  try {
    await api('campanhas', { metodo: 'POST', corpo: {
      titulo: $('campTitulo').value, mensagem: $('campMensagem').value, grupos: [...gruposEscolhidos],
    } });
    toast('Campanha enviada — entrou na fila do robô.', 'sucesso');
    $('formCampanha').reset();
    gruposEscolhidos.clear();
    desenharChipsGrupo();
    carregarCampanhas();
  } catch (err) { toast(err.message, 'erro'); }
});

/* ---------- Lembretes automáticos ---------- */
function atualizarCampoDia() {
  $('campoDiaDoMes').hidden = $('regraTipo').value === 'aniversario';
}
$('regraTipo').addEventListener('change', atualizarCampoDia);
atualizarCampoDia();

const ROTULO_TIPO = { aniversario: 'Aniversário', dizimo_mensal: 'Dízimo mensal', lembrete: 'Lembrete geral' };

async function carregarRegras() {
  const caixa = $('listaRegras');
  caixa.replaceChildren(el('div', { class: 'esqueleto cartao-esq baixo' }));
  let lista;
  try { lista = await api('regras-automaticas'); } catch (err) { caixa.replaceChildren(el('p', { class: 'erro', texto: err.message })); return; }
  if (!lista.length) { caixa.replaceChildren(vazio('Nenhuma regra criada ainda.')); return; }
  caixa.replaceChildren(...lista.map((r) => el('div', { class: 'cartao-lista' }, [
    el('div', { class: 'linha' }, [
      el('div', {}, [
        el('strong', { texto: r.titulo }),
        el('span', { class: 'suave pequeno', texto: ` · ${ROTULO_TIPO[r.tipo]}${r.diaDoMes ? ` · dia ${r.diaDoMes}` : ''}` }),
      ]),
      el('button', {
        type: 'button', class: 'secundario pequeno-botao', texto: r.ativa ? 'Ativa' : 'Pausada',
        onclick: async () => {
          try { await api(`regras-automaticas/${r.id}`, { metodo: 'PATCH', corpo: {} }); carregarRegras(); }
          catch (err) { toast(err.message, 'erro'); }
        },
      }),
    ]),
    el('p', { class: 'suave', texto: r.mensagem }),
  ])));
}

$('btnCriarRegra').addEventListener('click', async () => {
  if (!$('formRegra').reportValidity()) return;
  try {
    await api('regras-automaticas', { metodo: 'POST', corpo: {
      tipo: $('regraTipo').value, titulo: $('regraTitulo').value, mensagem: $('regraMensagem').value,
      diaDoMes: $('regraTipo').value === 'aniversario' ? undefined : Number($('regraDia').value),
    } });
    toast('Regra criada.', 'sucesso');
    $('formRegra').reset();
    atualizarCampoDia();
    carregarRegras();
  } catch (err) { toast(err.message, 'erro'); }
});

$('btnExecutarLembretes').addEventListener('click', async () => {
  try {
    const r = await api('regras-automaticas/executar', { metodo: 'POST', corpo: {} });
    toast(r.enfileiradas ? `${r.enfileiradas} mensagem(ns) entraram na fila do robô.` : 'Nenhuma regra bateu com a data de hoje.', 'sucesso');
  } catch (err) { toast(err.message, 'erro'); }
});

document.addEventListener('vista', (e) => {
  if (e.detail === 'campanhas') carregarCampanhas();
  if (e.detail === 'lembretes') carregarRegras();
});
})();
