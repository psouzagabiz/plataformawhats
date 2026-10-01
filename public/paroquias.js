/* Entre paróquias: mural entre instituições conectadas.
Usa as funções de app.js ($, api, el, toast, vazio). */
(() => {
async function carregar() {
  const caixa = $('listaMensagensParoquia');
  caixa.replaceChildren(el('div', { class: 'esqueleto cartao-esq baixo' }));
  let dados;
  try { dados = await api('mensagens-entre-paroquias'); } catch (err) {
    caixa.replaceChildren(el('p', { class: 'erro', texto: err.message }));
    return;
  }
  const sel = $('mpParaId');
  const atual = sel.value;
  sel.replaceChildren(el('option', { value: '', texto: 'Todas as paróquias conectadas' }),
    ...dados.paroquias.map((p) => el('option', { value: String(p.id), texto: p.nome })));
  sel.value = atual;

  if (!dados.mensagens.length) { caixa.replaceChildren(vazio('Nenhuma mensagem entre paróquias ainda.')); return; }
  caixa.replaceChildren(...dados.mensagens.map((m) => el('div', { class: 'cartao-lista' }, [
    el('div', { class: 'linha' }, [
      el('strong', { texto: m.deNome }),
      el('span', { class: 'suave pequeno', texto: new Date(m.criadoEm).toLocaleString('pt-BR') }),
    ]),
    el('p', { class: 'suave pequeno', texto: m.paraParoquiaId ? 'Mensagem direta' : 'Para todas as paróquias' }),
    el('p', {}, m.texto),
  ])));
}

$('btnEnviarMensagemParoquia').addEventListener('click', async () => {
  if (!$('formMensagemParoquia').reportValidity()) return;
  try {
    await api('mensagens-entre-paroquias', { metodo: 'POST', corpo: {
      texto: $('mpTexto').value, paraParoquiaId: $('mpParaId').value || null,
    } });
    $('formMensagemParoquia').reset();
    toast('Mensagem enviada.', 'sucesso');
    carregar();
  } catch (err) { toast(err.message, 'erro'); }
});

document.addEventListener('vista', (e) => { if (e.detail === 'paroquias') carregar(); });
})();
