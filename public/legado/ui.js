/* Comportamentos de interface: tema claro/escuro, menu recolhível, gaveta no celular,
busca do cabeçalho e indicador do robô. Usa as funções de app.js ($, estado, mostrarVista...). */
(() => {
const raiz = document.documentElement;
const guardar = (chave, valor) => { try { localStorage.setItem(chave, valor); } catch {} };

/* ---------- Tema ---------- */
function rotularTema() {
  const escuro = raiz.dataset.theme === 'dark';
  const texto = escuro ? 'Usar tema claro' : 'Usar tema escuro';
  $('btnTema').setAttribute('aria-label', texto);
  $('btnTema').title = texto;
  document.querySelector('meta[name=theme-color]').content = escuro ? '#0a1a36' : '#0a3576';
}
$('btnTema').addEventListener('click', () => {
  const novo = raiz.dataset.theme === 'dark' ? 'light' : 'dark';
  raiz.classList.add('trocando-tema');
  raiz.dataset.theme = novo;
  guardar('tema', novo === 'dark' ? 'escuro' : 'claro');
  rotularTema();
  setTimeout(() => raiz.classList.remove('trocando-tema'), 300);
});
// sem escolha salva, acompanha o sistema
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  let salvo = null;
  try { salvo = localStorage.getItem('tema'); } catch {}
  if (!salvo) { raiz.dataset.theme = e.matches ? 'dark' : 'light'; rotularTema(); }
});
rotularTema();

/* ---------- Menu lateral: recolher (computador) e gaveta (celular) ---------- */
const celular = () => matchMedia('(max-width: 760px)').matches;
function rotularRecolher() {
  const recolhido = raiz.classList.contains('menu-recolhido');
  const texto = recolhido ? 'Expandir menu' : 'Recolher menu';
  $('btnRecolher').setAttribute('aria-label', texto);
  $('btnRecolher').title = texto;
  $('btnRecolher').querySelector('span').textContent = texto;
}
$('btnRecolher').addEventListener('click', () => {
  raiz.classList.toggle('menu-recolhido');
  guardar('menuRecolhido', raiz.classList.contains('menu-recolhido') ? '1' : '0');
  rotularRecolher();
});
rotularRecolher();

function gaveta(abrir) {
  raiz.classList.toggle('gaveta-aberta', abrir);
  $('fundoGaveta').hidden = !abrir;
  $('btnGaveta').setAttribute('aria-expanded', String(abrir));
  if (abrir) document.querySelector('.nav.ativa')?.focus();
}
$('btnGaveta').addEventListener('click', () => gaveta(true));
$('fundoGaveta').addEventListener('click', () => gaveta(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && raiz.classList.contains('gaveta-aberta')) { gaveta(false); $('btnGaveta').focus(); } });
document.querySelectorAll('.nav[data-vista]').forEach((b) => b.addEventListener('click', () => { if (celular()) gaveta(false); }));
// atalhos do Painel ("Abrir agenda", "Ver atendimentos"...)
document.addEventListener('click', (e) => {
  const alvo = e.target.closest('[data-ir]');
  if (alvo) document.querySelector(`.nav[data-vista="${alvo.dataset.ir}"]`)?.click();
});
// marca o item ativo para leitores de tela
document.addEventListener('vista', (e) => {
  document.querySelectorAll('.nav[data-vista]').forEach((b) => {
    if (b.dataset.vista === e.detail) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
});

/* ---------- Busca do cabeçalho: filtra a lista de atendimentos ---------- */
$('buscaGlobal').addEventListener('input', () => {
  const termo = $('buscaGlobal').value;
  if (estado.vista !== 'atendimento') mostrarVista('atendimento');
  if (termo && estado.filtro !== 'todas') { estado.filtro = 'todas'; desenharAbas(); }
  $('busca').value = termo;
  desenharLista();
});
$('busca').addEventListener('input', () => { $('buscaGlobal').value = $('busca').value; });

/* ---------- Indicador do robô no cabeçalho (acompanha a faixa de aviso) ---------- */
function estadoRobo() {
  const desligado = !$('avisoRobo').hidden;
  $('estadoRobo').classList.toggle('desligado', desligado);
  $('estadoRoboTexto').textContent = desligado ? 'Robô desconectado' : 'Robô conectado';
  $('estadoRobo').title = desligado ? 'O computador da paróquia está desligado ou sem internet' : 'O robô está respondendo no WhatsApp';
}
new MutationObserver(estadoRobo).observe($('avisoRobo'), { attributes: true, attributeFilter: ['hidden'] });
estadoRobo();

/* ---------- Menu do usuário: fecha com Esc ---------- */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('menuUsuario').hidden) { $('menuUsuario').hidden = true; $('btnUsuario').setAttribute('aria-expanded', 'false'); $('btnUsuario').focus(); }
});
})();
