/* Painel matriz: só aparece para a administradora da plataforma (super-admin).
Usa as funções de app.js ($, api, el, toast, confirmar). */
(() => {
const TIPOS = { paroquia: 'Paróquia', escola: 'Escola católica', outro: 'Outro' };

async function carregar() {
  const caixa = $('matrizLista');
  caixa.replaceChildren(...[1, 2, 3].map(() => el('div', { class: 'esqueleto cartao-esq baixo' })));
  let lista;
  try { lista = await api('matriz/instituicoes'); } catch (err) {
    caixa.replaceChildren(el('p', { class: 'erro', texto: err.message }));
    return;
  }
  if (!lista.length) { caixa.replaceChildren(vazio('Nenhuma instituição cadastrada ainda.')); return; }

  caixa.replaceChildren(el('div', { class: 'tabela-rolagem' }, el('table', { class: 'tabela' }, [
    el('thead', {}, el('tr', {}, ['Instituição', 'Tipo', 'Atendentes', 'Conversas ativas', 'Situação', 'Criada em', ''].map((t) => el('th', { scope: 'col', texto: t })))),
    el('tbody', {}, lista.map((i) => el('tr', {}, [
      el('td', {}, el('strong', { texto: i.nome })),
      el('td', { texto: TIPOS[i.tipo] || i.tipo }),
      el('td', { texto: String(i.totalAtendentes) }),
      el('td', { texto: String(i.conversasAtivas) }),
      el('td', {}, el('span', { class: `selo ${i.status === 'ativa' ? 'encerrado' : 'aguardando-equipe'}`, texto: i.status === 'ativa' ? 'Ativa' : 'Suspensa' })),
      el('td', { class: 'suave pequeno', texto: new Date(i.criadoEm).toLocaleDateString('pt-BR') }),
      el('td', {}, el('button', {
        type: 'button', class: 'secundario pequeno-botao',
        texto: i.status === 'ativa' ? 'Suspender' : 'Reativar',
        onclick: () => alternarStatus(i),
      })),
    ]))),
  ])));
}

async function alternarStatus(i) {
  const suspender = i.status === 'ativa';
  const pergunta = suspender
    ? `Suspender "${i.nome}"?`
    : `Reativar "${i.nome}"?`;
  const texto = suspender
    ? 'A equipe dessa instituição deixa de conseguir entrar na plataforma até você reativar.'
    : 'A equipe volta a conseguir entrar na plataforma normalmente.';
  if (!(await confirmar(pergunta, texto, suspender ? 'Suspender' : 'Reativar'))) return;
  try {
    await api(`matriz/instituicoes/${suspender ? 'suspender' : 'reativar'}`, { metodo: 'POST', corpo: { id: i.id } });
    toast(suspender ? 'Instituição suspensa.' : 'Instituição reativada.', 'sucesso');
    carregar();
  } catch (err) { toast(err.message, 'erro'); }
}

document.addEventListener('vista', (e) => { if (e.detail === 'matriz') carregar().catch((err) => toast(err.message, 'erro')); });
})();
