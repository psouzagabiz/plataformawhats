/* Plataforma de atendimento do Paroquiano: setores, chat, comprovantes e textos do robô */
const $ = (id) => document.getElementById(id);

const SETORES = {
  recepcao: { nome: 'Recepção', quem: 'Gabriela' },
  documentos: { nome: 'Documentos', quem: 'Jucilda' },
  financeiro: { nome: 'Financeiro', quem: 'Tiago' },
};
const CATEGORIAS = { dizimo: 'Dízimo', doacao: 'Doação', aluguel: 'Aluguel' };

const estado = {
  eu: null,
  vista: 'atendimento',
  filtro: null, // setor da aba aberta ('todas' = todas as conversas)
  conversas: [],
  aberta: null, // telefone da conversa aberta
  conversaAberta: null,
  ultimoId: 0,
  ultimoDia: '',
  arquivo: null,
  conversasCarregadas: false,
  somAtivo: lembrete('som') !== '0',
};

/* =================== Utilitários =================== */
async function api(caminho, { metodo = 'GET', corpo } = {}) {
  const resp = await fetch('/api/' + caminho, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : {},
    body: corpo ? JSON.stringify(corpo) : undefined,
    cache: 'no-store',
  });
  if (resp.status === 401 && caminho !== 'entrar' && caminho !== 'senha') {
    mostrarLogin();
    throw new Error('Sessão expirada. Entre novamente.');
  }
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(dados.erro || `Erro ${resp.status}`);
  return dados;
}

// notificação no canto da tela; tipo: 'info' | 'sucesso' | 'erro'
function toast(texto, tipo = 'info') {
  const icones = { info: 'info', sucesso: 'confirma', erro: 'alerta' };
  const caixa = $('toasts');
  const fechar = () => { t.classList.add('saindo'); setTimeout(() => t.remove(), 200); };
  const t = el('div', { class: `toast ${tipo}`, role: tipo === 'erro' ? 'alert' : 'status' }, [
    icone(icones[tipo] || 'info'),
    el('span', { texto }),
    el('button', { type: 'button', class: 'botao-icone mini', 'aria-label': 'Fechar aviso', onclick: fechar }, icone('fechar')),
  ]);
  caixa.append(t);
  while (caixa.children.length > 3) caixa.firstChild.remove();
  setTimeout(fechar, tipo === 'erro' ? 7000 : 4500);
}

// sino de novas mensagens: dois tons sintetizados por Web Audio, sem depender de arquivo
let contextoAudio;
function tocarSino() {
  try {
    contextoAudio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (contextoAudio.state === 'suspended') contextoAudio.resume();
    const agora = contextoAudio.currentTime;
    const tom = (freq, inicio, duracao, ganho) => {
      const osc = contextoAudio.createOscillator();
      const g = contextoAudio.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      g.gain.setValueAtTime(0, inicio);
      g.gain.linearRampToValueAtTime(ganho, inicio + .015);
      g.gain.exponentialRampToValueAtTime(.0001, inicio + duracao);
      osc.connect(g); g.connect(contextoAudio.destination);
      osc.start(inicio); osc.stop(inicio + duracao + .05);
    };
    tom(659.25, agora, .28, .1);        // Mi5
    tom(987.77, agora + .09, .32, .09); // Si5
  } catch { /* som é um extra; nunca deve travar o painel */ }
}

// estado vazio: ilustração simples + orientação do próximo passo
function vazio(titulo, texto, acao) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'ilustracao');
  svg.setAttribute('viewBox', '0 0 120 90');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<rect x="22" y="16" width="76" height="58" rx="10" class="il-a"/><path d="M36 36h48M36 48h30" class="il-traco claro"/>'
    + '<circle cx="86" cy="64" r="14" class="il-b"/><path d="M86 57v14M79 64h14" class="il-dourado"/>';
  return el('div', { class: 'estado-vazio' }, [
    svg, el('p', {}, el('strong', { texto: titulo })), texto ? el('p', { class: 'pequeno', texto }) : null,
    acao ? el('button', { type: 'button', class: 'secundario', onclick: acao.onclick }, [acao.icone ? icone(acao.icone) : null, acao.texto]) : null,
  ]);
}

// selo de status padronizado de uma conversa
function statusConversa(c) {
  if (c.estado === 'humano') {
    return c.ultimaRemetente === 'cliente' || !c.ultimaRemetente
      ? { classe: 'aguardando-equipe', texto: 'Aguardando equipe' }
      : { classe: 'aguardando-fiel', texto: 'Aguardando fiel' };
  }
  if (c.estado === 'encerrado') return { classe: 'encerrado', texto: 'Encerrado' };
  return { classe: 'robo', texto: 'Com o robô' };
}
const selo = (s) => el('span', { class: `selo ${s.classe}`, texto: s.texto });

function el(tag, props = {}, filhos = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'texto') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const f of [].concat(filhos)) if (f !== null && f !== undefined && f !== false) e.append(f);
  return e;
}

// ícone da coleção em index.html (<symbol id="i-...">)
function icone(nome, classe = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `ic ${classe}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${nome}`);
  svg.append(use);
  return svg;
}
// bolinha colorida do setor ('robo' = conversa com o robô)
const ponto = (setor) => el('span', { class: `ponto p-${setor}`, 'aria-hidden': 'true' });
// círculo com as iniciais, com uma cor fixa para cada pessoa
function avatar(nome, chave = nome) {
  const partes = String(nome || '').replace(/[^\p{L}\s]/gu, '').trim().split(/\s+/).filter(Boolean);
  const iniciais = partes.length ? (partes[0][0] + (partes.length > 1 ? partes.at(-1)[0] : '')).toUpperCase() : '#';
  let h = 0;
  for (const ch of String(chave)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return el('span', { class: `avatar c${(h % 6) + 1}`, 'aria-hidden': 'true', texto: iniciais });
}

function confirmar(titulo, texto, rotuloOk = 'Confirmar') {
  return new Promise((ok) => {
    $('confirmarTitulo').textContent = titulo;
    $('confirmarTexto').textContent = texto;
    $('confirmarOk').textContent = rotuloOk;
    $('dlgConfirmar').returnValue = '';
    $('dlgConfirmar').showModal();
    $('dlgConfirmar').addEventListener('close', () => ok($('dlgConfirmar').returnValue === 'ok'), { once: true });
  });
}

function numero(tel) {
  if (!tel.endsWith('@c.us')) return 'número oculto pelo WhatsApp';
  const d = tel.replace(/@.*/, '');
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : `+${d}`;
}
const nomeDe = (c) => c?.nome || (c ? numero(c.telefone) : '');

function horaCurta(s) {
  if (!s) return '';
  const d = new Date(s);
  const hoje = new Date().toDateString() === d.toDateString();
  return hoje ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

// formatação do WhatsApp (*negrito*, _itálico_, ~riscado~) montada com segurança
function formatarWhats(texto, destino) {
  const regex = /\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g;
  let pos = 0;
  let m;
  while ((m = regex.exec(texto))) {
    destino.append(texto.slice(pos, m.index));
    destino.append(el(m[1] ? 'b' : m[2] ? 'i' : 's', { texto: m[1] || m[2] || m[3] }));
    pos = regex.lastIndex;
  }
  destino.append(texto.slice(pos));
}

const arquivoUrl = (id) => `/api/arquivo?id=${encodeURIComponent(id)}`;

/* =================== Login =================== */
function lembrete(chave) { try { return localStorage.getItem(chave); } catch { return null; } }
function lembrar(chave, valor) { try { localStorage.setItem(chave, valor); } catch {} }

async function mostrarLogin() {
  pararAtualizacoes();
  $('telaApp').hidden = true;
  $('telaLogin').hidden = false;
  $('erroLogin').hidden = true;
  $('loginInstituicaoResultados').replaceChildren();
  $('loginInstituicaoResultados').hidden = true;

  const paroquiaId = lembrete('paroquiaId');
  const paroquiaNome = lembrete('paroquiaNome');
  if (paroquiaId && paroquiaNome) {
    await escolherInstituicao(Number(paroquiaId), paroquiaNome);
  } else {
    mostrarPassoInstituicao();
  }
}

function mostrarPassoInstituicao() {
  $('passoInstituicao').hidden = false;
  $('passoAtendente').hidden = true;
  $('loginInstituicaoBusca').value = '';
  $('loginInstituicaoBusca').focus();
}

async function escolherInstituicao(id, nome) {
  estado.paroquiaId = id;
  lembrar('paroquiaId', String(id));
  lembrar('paroquiaNome', nome);
  $('loginInstituicaoNome').textContent = nome;
  $('passoInstituicao').hidden = true;
  $('passoAtendente').hidden = false;
  const caixa = $('opcoesAtendente');
  caixa.replaceChildren(...[1, 2, 3].map(() => el('div', { class: 'esqueleto linha-alta' })));
  try {
    const lista = await api(`atendentes?paroquiaId=${id}`);
    let lembrado = null;
    try { lembrado = localStorage.getItem('atendenteId'); } catch {}
    caixa.replaceChildren();
    for (const a of lista) {
      const s = SETORES[a.setor] || { nome: a.setor };
      caixa.append(el('label', {}, [
        avatar(a.nome),
        el('span', { class: 'quem' }, [el('strong', { texto: a.nome }), el('span', {}, [ponto(a.setor), s.nome])]),
        el('input', { type: 'radio', name: 'atendente', value: a.id, required: '', checked: String(a.id) === lembrado ? '' : null }),
      ]));
    }
    if (!lista.length) caixa.replaceChildren(el('p', { class: 'suave pequeno', texto: 'Nenhum atendente cadastrado ainda nessa instituição.' }));
  } catch (e) {
    caixa.replaceChildren(el('p', { class: 'erro', texto: 'Não foi possível carregar os atendentes: ' + e.message }));
  }
  $('loginSenha').focus();
}

let buscaInstituicaoTimer = null;
$('loginInstituicaoBusca').addEventListener('input', () => {
  clearTimeout(buscaInstituicaoTimer);
  const termo = $('loginInstituicaoBusca').value.trim();
  const caixa = $('loginInstituicaoResultados');
  if (termo.length < 2) { caixa.hidden = true; caixa.replaceChildren(); return; }
  buscaInstituicaoTimer = setTimeout(async () => {
    let lista = [];
    try { lista = await api(`instituicoes?busca=${encodeURIComponent(termo)}`); } catch { /* ignora erro de busca */ }
    caixa.replaceChildren();
    if (!lista.length) {
      caixa.append(el('p', { class: 'suave pequeno', texto: 'Nenhuma instituição encontrada com esse nome.' }));
    } else {
      for (const inst of lista) {
        caixa.append(el('button', { type: 'button', onclick: () => escolherInstituicao(inst.id, inst.nome) }, [
          el('strong', { texto: inst.nome }), inst.cidade ? el('span', { class: 'suave pequeno', texto: ` — ${inst.cidade}` }) : null,
        ]));
      }
    }
    caixa.hidden = false;
  }, 300);
});

$('btnTrocarInstituicao').addEventListener('click', () => {
  lembrar('paroquiaId', ''); lembrar('paroquiaNome', '');
  try { localStorage.removeItem('paroquiaId'); localStorage.removeItem('paroquiaNome'); } catch {}
  mostrarPassoInstituicao();
});

$('formLogin').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('erroLogin').hidden = true;
  const escolhido = document.querySelector('input[name=atendente]:checked');
  if (!escolhido) return;
  $('btnEntrar').disabled = true;
  try {
    await api('entrar', { metodo: 'POST', corpo: { atendenteId: Number(escolhido.value), senha: $('loginSenha').value } });
    try { localStorage.setItem('atendenteId', escolhido.value); } catch {}
    $('loginSenha').value = '';
    await iniciarApp();
  } catch (err) {
    $('erroLogin').textContent = err.message;
    $('erroLogin').hidden = false;
  } finally {
    $('btnEntrar').disabled = false;
  }
});

/* ---------- Criar instituição (cadastro self-service) ---------- */
$('btnAbrirCadastro').addEventListener('click', () => {
  $('erroCadastro').hidden = true;
  $('formCadastroInstituicao').reset();
  $('dlgCadastroInstituicao').showModal();
});
$('dlgCadastroInstituicao').addEventListener('close', async () => {
  if ($('dlgCadastroInstituicao').returnValue !== 'ok') return;
  const corpo = {
    nomeInstituicao: $('cadNome').value, tipo: $('cadTipo').value,
    nomeResponsavel: $('cadResponsavel').value, contatoEmail: $('cadEmail').value, senha: $('cadSenha').value,
  };
  try {
    const r = await api('instituicoes', { metodo: 'POST', corpo });
    lembrar('paroquiaId', String(r.paroquiaId));
    lembrar('paroquiaNome', corpo.nomeInstituicao);
    try { localStorage.setItem('atendenteId', ''); } catch {}
    await iniciarApp();
  } catch (err) {
    $('erroCadastro').textContent = err.message;
    $('erroCadastro').hidden = false;
    $('dlgCadastroInstituicao').showModal();
  }
});

async function iniciarApp() {
  estado.eu = await api('eu');
  $('nomeAtendente').textContent = estado.eu.nome;
  const s = SETORES[estado.eu.setor];
  $('setorAtendente').textContent = s ? s.nome : estado.eu.setor;
  $('avatarAtendente').textContent = avatar(estado.eu.nome).textContent;
  $('avisoRobo').hidden = estado.eu.roboOnline;
  $('navMatriz').hidden = !estado.eu.superAdmin;
  if (!estado.filtro) estado.filtro = estado.eu.setor;
  $('telaLogin').hidden = true;
  $('telaApp').hidden = false;
  await carregarConversas();
  mostrarVista('painel');
  iniciarAtualizacoes();
}

/* ---------- Menu do usuário ---------- */
$('btnUsuario').addEventListener('click', (e) => {
  e.stopPropagation();
  const abrir = $('menuUsuario').hidden;
  $('menuUsuario').hidden = !abrir;
  $('btnUsuario').setAttribute('aria-expanded', String(abrir));
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.usuario')) $('menuUsuario').hidden = true;
  if (!e.target.closest('.menu-prontas')) fecharProntas();
});
$('btnSair').addEventListener('click', async () => {
  await api('sair', { metodo: 'POST', corpo: {} }).catch(() => {});
  estado.aberta = null;
  mostrarLogin();
});
$('btnTrocarSenha').addEventListener('click', () => {
  $('menuUsuario').hidden = true;
  $('erroSenha').hidden = true;
  $('formSenha').reset();
  $('dlgSenha').showModal();
});
$('formSenha').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'ok') return;
  e.preventDefault();
  try {
    await api('senha', { metodo: 'POST', corpo: { atual: $('senhaAtual').value, nova: $('senhaNova').value } });
    $('dlgSenha').close();
    toast('Senha alterada.', 'sucesso');
  } catch (err) {
    $('erroSenha').textContent = err.message;
    $('erroSenha').hidden = false;
  }
});

/* =================== Navegação entre seções =================== */
function mostrarVista(vista) {
  estado.vista = vista;
  document.querySelectorAll('.nav').forEach((b) => b.classList.toggle('ativa', b.dataset.vista === vista));
  document.querySelectorAll('section.vista').forEach((v) => { v.hidden = v.dataset.nome !== vista; });
  if (vista === 'comprovantes') carregarComprovantes();
  if (vista === 'textos') carregarTextos();
  document.dispatchEvent(new CustomEvent('vista', { detail: vista })); // agenda.js carrega as suas seções
}
document.querySelectorAll('.nav').forEach((b) => b.addEventListener('click', async () => {
  if (estado.vista === 'textos' && b.dataset.vista !== 'textos' && textosAlterados()) {
    if (!(await confirmar('Sair sem salvar?', 'Há alterações nas mensagens do robô que ainda não foram salvas.', 'Sair sem salvar'))) return;
  }
  mostrarVista(b.dataset.vista);
}));

/* =================== Lista de conversas =================== */
async function carregarConversas() {
  try {
    const novas = await api('conversas');
    if (estado.conversasCarregadas) notificarSeChegouMensagem(estado.conversas, novas);
    estado.conversas = novas;
    estado.conversasCarregadas = true;
    desenharAbas();
    desenharLista();
  } catch { /* tenta de novo na próxima atualização */ }
}

// toca o sino quando uma conversa recebe mensagem nova do fiel (não da própria equipe/robô
// respondendo) — comparado com o instantâneo anterior, ignorado na primeira carga (login)
function notificarSeChegouMensagem(antes, depois) {
  const vistoPor = new Map(antes.map((c) => [c.telefone, c.ultimaEm]));
  const chegou = depois.some((c) => c.ultimaRemetente === 'cliente' && c.ultimaEm && c.ultimaEm !== vistoPor.get(c.telefone));
  if (!chegou) return;
  $('btnSom').classList.remove('tocando');
  void $('btnSom').offsetWidth;
  $('btnSom').classList.add('tocando');
  if (estado.somAtivo) tocarSino();
}

const aguardando = (c) => c.estado === 'humano';

function desenharAbas() {
  const abas = $('abasSetor');
  abas.replaceChildren();
  const itens = [...Object.entries(SETORES), ['todas', { nome: 'Todas' }]];
  for (const [id, s] of itens) {
    const n = id === 'todas' ? 0 : estado.conversas.filter((c) => aguardando(c) && c.setor === id).length;
    abas.append(el('button', {
      role: 'tab', class: `aba${estado.filtro === id ? ' ativa' : ''}`, 'aria-selected': String(estado.filtro === id),
      title: id === 'todas' ? 'Todas as conversas, inclusive com o robô' : `Chamados de ${s.nome} (${s.quem})`,
      onclick: () => { estado.filtro = id; desenharAbas(); desenharLista(); },
    }, [id === 'todas' ? null : ponto(id), s.nome, n ? el('span', { class: 'contador', texto: String(n) }) : null]));
  }
  // no menu: quantas pessoas do meu setor esperam resposta da equipe
  const meus = estado.conversas.filter((c) => c.estado === 'humano' && c.setor === estado.eu?.setor && c.ultimaRemetente === 'cliente').length;
  $('navContador').textContent = String(meus);
  $('navContador').hidden = !meus;
  $('navContador').setAttribute('aria-label', `${meus} aguardando resposta`);
}

function desenharLista() {
  const busca = $('busca').value.trim().toLowerCase();
  const digitos = busca.replace(/\D/g, '');
  let lista = estado.filtro === 'todas'
    ? estado.conversas
    : estado.conversas.filter((c) => aguardando(c) && c.setor === estado.filtro);
  if (busca) lista = lista.filter((c) => nomeDe(c).toLowerCase().includes(busca) || (digitos && c.telefone.includes(digitos)));

  const ul = $('listaConversas');
  ul.replaceChildren();
  if (!lista.length) {
    ul.append(el('li', { class: 'lista-vazia' }, busca
      ? vazio('Nenhuma conversa encontrada', 'Confira o nome ou o número digitado, ou procure em "Todas".')
      : estado.filtro === 'todas'
        ? vazio('Nenhuma conversa ainda', 'As conversas aparecem aqui assim que alguém escrever para o WhatsApp da paróquia.')
        : vazio(`Nenhum chamado em ${SETORES[estado.filtro].nome}`, 'Quando o robô passar uma conversa para este setor, ela aparece aqui.',
          { texto: 'Ver todas as conversas', onclick: () => { estado.filtro = 'todas'; desenharAbas(); desenharLista(); } })));
    return;
  }
  for (const c of lista) {
    let previa = c.ultimaTexto || (c.ultimaMidia ? 'Arquivo' : '');
    if (c.ultimaRemetente === 'bot') previa = 'Robô: ' + previa;
    if (c.ultimaRemetente === 'atendente') previa = 'Equipe: ' + previa;
    const s = SETORES[c.setor];
    ul.append(el('li', {}, el('button', {
      class: c.telefone === estado.aberta ? 'selecionada' : '',
      'aria-current': c.telefone === estado.aberta ? 'true' : null,
      onclick: () => abrirConversa(c.telefone),
    }, [
      avatar(nomeDe(c), c.telefone),
      el('span', { class: 'nome', texto: nomeDe(c) }),
      el('span', { class: 'hora', texto: horaCurta(c.ultimaEm) }),
      el('span', { class: 'previa', texto: previa.split('\n')[0] }),
      el('span', { class: 'rodape-item' }, [
        selo(statusConversa(c)),
        aguardando(c) && s && estado.filtro === 'todas' ? el('span', { class: 'setor' }, [ponto(c.setor), s.nome]) : null,
      ]),
    ])));
  }
}
$('busca').addEventListener('input', desenharLista);

/* =================== Conversa aberta =================== */
async function abrirConversa(telefone) {
  mostrarVista('atendimento');
  estado.aberta = telefone;
  estado.ultimoId = 0;
  estado.ultimoDia = '';
  $('mensagens').replaceChildren();
  $('chatVazio').hidden = true;
  $('chatAberto').hidden = false;
  $('vistaAtendimento').classList.add('com-chat');
  desenharLista();
  await carregarMensagens();
  $('texto').focus();
}

$('btnVoltar').addEventListener('click', () => {
  estado.aberta = null;
  $('vistaAtendimento').classList.remove('com-chat');
  $('chatAberto').hidden = true;
  $('chatVazio').hidden = false;
  desenharLista();
});

async function carregarMensagens() {
  const tel = estado.aberta;
  if (!tel) return;
  let dados;
  try {
    dados = await api(`mensagens?telefone=${encodeURIComponent(tel)}&depois=${estado.ultimoId}`);
  } catch { return; }
  if (tel !== estado.aberta) return; // trocou de conversa enquanto carregava

  const c = dados.conversa || { telefone: tel, estado: null, setor: null };
  estado.conversaAberta = c;
  $('chatNome').textContent = nomeDe(c);
  const av = avatar(nomeDe(c), tel);
  $('chatAvatar').className = av.className;
  $('chatAvatar').textContent = av.textContent;
  const humano = c.estado === 'humano';
  const s = SETORES[c.setor];
  const ultima = estado.conversas.find((x) => x.telefone === tel);
  $('chatInfo').replaceChildren(el('span', { texto: numero(tel) }), selo(statusConversa({ ...c, ultimaRemetente: ultima?.ultimaRemetente })),
    humano && s ? el('span', { class: 'setor' }, [ponto(c.setor), ` ${s.nome} (${s.quem})`]) : null);
  $('btnAssumir').hidden = humano;
  $('btnEncerrar').hidden = !humano;
  if (document.activeElement !== $('selSetor')) $('selSetor').value = c.setor || estado.eu.setor;
  $('enviando').hidden = !dados.enviando;

  if (!dados.mensagens.length) return;
  const caixa = $('mensagens');
  const primeiraCarga = estado.ultimoId === 0;
  const noFim = caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight < 80;
  for (const m of dados.mensagens) {
    desenharMensagem(m);
    estado.ultimoId = m.id;
  }
  if (noFim || primeiraCarga) caixa.scrollTop = caixa.scrollHeight;
}

function desenharMensagem(m) {
  const caixa = $('mensagens');
  const d = new Date(m.criadoEm);
  const dia = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  if (dia !== estado.ultimoDia) {
    caixa.append(el('div', { class: 'dia', texto: dia }));
    estado.ultimoDia = dia;
  }
  const bolha = el('div', { class: `msg ${m.remetente}` });
  if (m.remetente === 'atendente') bolha.append(el('span', { class: 'autor', texto: m.autor || 'Atendente' }));
  if (m.remetente === 'bot') bolha.append(el('span', { class: 'autor' }, [icone('robo'), 'Robô']));
  if (m.midiaId) bolha.append(elementoMidia(m.midiaId, m.midiaTipo));
  if (m.texto) {
    const t = el('span');
    formatarWhats(m.texto, t);
    bolha.append(t);
  }
  if (m.remetente !== 'sistema') {
    bolha.append(el('span', { class: 'hora', texto: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }));
  }
  caixa.append(bolha);
}

function elementoMidia(id, tipo = '') {
  const src = arquivoUrl(id);
  if (tipo.startsWith('image/')) return el('a', { href: src, target: '_blank', rel: 'noopener' }, el('img', { src, alt: 'Imagem', loading: 'lazy' }));
  if (tipo.startsWith('video/')) return el('video', { src, controls: '' });
  if (tipo.startsWith('audio/')) return el('audio', { src, controls: '' });
  return el('a', { class: 'arquivo', href: src, target: '_blank', rel: 'noopener' }, [icone('arquivo'), tipo.includes('pdf') ? 'Abrir PDF' : 'Abrir arquivo']);
}

/* ---------- Enviar texto ---------- */
const campoTexto = $('texto');
function ajustarAltura() {
  campoTexto.style.height = 'auto';
  campoTexto.style.height = Math.min(campoTexto.scrollHeight + 2, 160) + 'px';
}
campoTexto.addEventListener('input', ajustarAltura);
campoTexto.addEventListener('keydown', (e) => {
  // Enter envia; Shift+Enter quebra a linha
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $('formEnvio').requestSubmit();
  }
});

$('formEnvio').addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = campoTexto.value.trim();
  if (!texto || !estado.aberta) return;
  $('btnEnviar').disabled = true;
  try {
    await api('enviar', { metodo: 'POST', corpo: { telefone: estado.aberta, texto } });
    campoTexto.value = '';
    ajustarAltura();
    await carregarMensagens();
    carregarConversas();
  } catch (err) {
    toast('Não foi possível enviar: ' + err.message, 'erro');
  } finally {
    $('btnEnviar').disabled = false;
    campoTexto.focus();
  }
});

/* ---------- Assumir / encerrar / transferir / renomear ---------- */
async function acao(caminho, corpo, sucesso) {
  try {
    await api(caminho, { metodo: 'POST', corpo: { telefone: estado.aberta, ...corpo } });
    if (sucesso) toast(sucesso, 'sucesso');
    await carregarMensagens();
    carregarConversas();
  } catch (err) { toast(err.message, 'erro'); }
}

$('btnAssumir').addEventListener('click', () => acao('assumir', {}, 'Você assumiu a conversa. O robô parou de responder.'));

$('btnEncerrar').addEventListener('click', async () => {
  if (!(await confirmar('Encerrar atendimento?', 'O cliente recebe a mensagem de despedida e o robô volta a responder.', 'Encerrar'))) return;
  acao('encerrar', {}, 'Atendimento encerrado. O robô voltou a responder.');
});

$('selSetor').addEventListener('change', async () => {
  const setor = $('selSetor').value;
  const atual = estado.conversaAberta?.estado === 'humano' ? estado.conversaAberta.setor : null;
  if (setor === atual) return;
  const s = SETORES[setor];
  if (!(await confirmar(`Transferir para ${s.nome}?`, `A conversa vai para a fila de ${s.nome} (${s.quem}), que recebe um aviso no WhatsApp.`, 'Transferir'))) {
    $('selSetor').value = atual || estado.eu.setor;
    return;
  }
  acao('transferir', { setor }, `Conversa transferida para ${s.nome}.`);
});

$('btnRenomear').addEventListener('click', () => {
  $('renomearNome').value = estado.conversaAberta?.nome || '';
  $('dlgRenomear').showModal();
});
$('dlgRenomear').addEventListener('close', () => {
  if ($('dlgRenomear').returnValue !== 'ok') return;
  const nome = $('renomearNome').value.trim();
  if (nome) acao('renomear', { nome });
});

/* ---------- Mensagens prontas ---------- */
async function desenharProntas() {
  const caixa = $('listaProntas');
  caixa.replaceChildren(el('p', { class: 'suave pequeno', texto: 'Carregando...' }));
  let prontas = [];
  try { prontas = await api('prontas'); } catch (err) { toast(err.message, 'erro'); }
  caixa.replaceChildren();
  for (const p of prontas) {
    caixa.append(el('div', { class: 'pronta' }, [
      el('button', { type: 'button', title: p.texto, texto: p.titulo, onclick: () => {
        campoTexto.value = p.texto;
        ajustarAltura();
        fecharProntas();
        campoTexto.focus();
      } }),
      el('button', { type: 'button', class: 'remover', title: 'Apagar', 'aria-label': 'Apagar', onclick: async () => {
        fecharProntas();
        if (!(await confirmar('Apagar mensagem pronta?', `"${p.titulo}" será apagada para todos.`, 'Apagar'))) return;
        await api(`prontas?id=${p.id}`, { metodo: 'DELETE', corpo: {} }).catch((e) => toast(e.message, 'erro'));
      } }, icone('fechar')),
    ]));
  }
  caixa.append(el('button', { type: 'button', class: 'nova', onclick: () => {
    fecharProntas();
    $('prontaTexto').value = campoTexto.value;
    $('dlgPronta').showModal();
  } }, [icone('mais'), 'Criar mensagem pronta']));
}
function fecharProntas() {
  $('listaProntas').hidden = true;
  $('btnProntas').setAttribute('aria-expanded', 'false');
}
$('btnProntas').addEventListener('click', () => {
  if (!$('listaProntas').hidden) return fecharProntas();
  $('listaProntas').hidden = false;
  $('btnProntas').setAttribute('aria-expanded', 'true');
  desenharProntas();
});
$('dlgPronta').addEventListener('close', async () => {
  if ($('dlgPronta').returnValue !== 'ok') return;
  try {
    await api('prontas', { metodo: 'POST', corpo: { titulo: $('prontaTitulo').value, texto: $('prontaTexto').value } });
    $('prontaTitulo').value = '';
    toast('Mensagem pronta salva.', 'sucesso');
  } catch (err) { toast(err.message, 'erro'); }
});

/* ---------- Enviar arquivo ---------- */
const MAX_ARQUIVO = 3 * 1024 * 1024;
$('btnPix').addEventListener('click', async () => {
  try {
    const { texto } = await api('pix/chave');
    campoTexto.value = campoTexto.value ? `${campoTexto.value}\n\n${texto}` : texto;
    ajustarAltura();
    campoTexto.focus();
  } catch (err) { toast(err.message, 'erro'); }
});

$('btnAnexo').addEventListener('click', () => $('arquivo').click());
$('arquivo').addEventListener('change', () => {
  const f = $('arquivo').files[0];
  $('arquivo').value = '';
  if (!f) return;
  if (f.size > MAX_ARQUIVO) return toast('Arquivo grande demais: o limite é 3 MB. Envie pelo celular.', 'erro');
  estado.arquivo = f;
  const previa = $('midiaPrevia');
  previa.replaceChildren();
  const url = URL.createObjectURL(f);
  if (f.type.startsWith('image/')) previa.append(el('img', { src: url, alt: '' }));
  else if (f.type.startsWith('video/')) previa.append(el('video', { src: url, controls: '' }));
  else previa.append(el('div', { class: 'arquivo' }, [icone('arquivo'), f.name]));
  $('midiaLegenda').value = '';
  $('erroMidia').hidden = true;
  $('dlgMidia').showModal();
});

$('formMidia').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'ok') return;
  e.preventDefault(); // mantém a janela aberta enquanto envia
  const f = estado.arquivo;
  $('btnMidiaEnviar').disabled = true;
  $('btnMidiaEnviar').textContent = 'Enviando...';
  try {
    const base64 = await new Promise((ok, erro) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).split(',')[1]);
      r.onerror = erro;
      r.readAsDataURL(f);
    });
    await api('midia', {
      metodo: 'POST',
      corpo: { telefone: estado.aberta, base64, tipo: f.type || 'application/octet-stream', nomeArquivo: f.name, legenda: $('midiaLegenda').value },
    });
    $('dlgMidia').close();
    await carregarMensagens();
    carregarConversas();
  } catch (err) {
    $('erroMidia').textContent = 'Não foi possível enviar: ' + err.message;
    $('erroMidia').hidden = false;
  } finally {
    $('btnMidiaEnviar').disabled = false;
    $('btnMidiaEnviar').textContent = 'Enviar';
  }
});

/* ---------- Nova conversa ---------- */
$('btnNova').addEventListener('click', () => {
  $('erroNova').hidden = true;
  $('dlgNova').showModal();
  $('novaNumero').focus();
});
$('formNova').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'ok') return;
  e.preventDefault();
  $('btnNovaEnviar').disabled = true;
  try {
    await api('nova', { metodo: 'POST', corpo: { numero: $('novaNumero').value, texto: $('novaTexto').value } });
    $('dlgNova').close();
    $('novaNumero').value = '';
    estado.filtro = estado.eu.setor;
    toast('Mensagem enviada ao robô. A conversa aparece na sua fila em alguns segundos.', 'sucesso');
  } catch (err) {
    $('erroNova').textContent = err.message;
    $('erroNova').hidden = false;
  } finally {
    $('btnNovaEnviar').disabled = false;
  }
});

/* =================== Comprovantes =================== */
async function carregarComprovantes() {
  const grade = $('listaComprovantes');
  let lista;
  try {
    lista = await api('comprovantes');
  } catch (err) {
    grade.replaceChildren(el('p', { class: 'erro', texto: err.message }));
    return;
  }
  const filtro = $('filtroComprovante').value;
  if (filtro) lista = lista.filter((c) => c.categoria === filtro);
  grade.replaceChildren();
  if (!lista.length) {
    grade.append(filtro
      ? vazio('Nenhum comprovante deste tipo', 'Escolha "Todos os tipos" para ver os outros comprovantes.')
      : vazio('Nenhum comprovante ainda', 'Quando alguém enviar a foto ou o PDF de um pagamento pelo WhatsApp, ele aparece aqui.'));
  }
  for (const c of lista) {
    const imagem = c.midiaId && (c.midiaTipo || '').startsWith('image/');
    grade.append(el('article', { class: 'comprovante' }, [
      c.midiaId
        ? el('a', { class: `imagem${imagem ? '' : ' pdf'}`, href: arquivoUrl(c.midiaId), target: '_blank', rel: 'noopener', title: 'Abrir' },
          imagem ? el('img', { src: arquivoUrl(c.midiaId), alt: `Comprovante de ${c.nome}`, loading: 'lazy' }) : icone('arquivo'))
        : el('div', { class: 'imagem pdf' }, icone('recibo')),
      el('div', { class: 'info' }, [
        el('span', { class: 'etiqueta setor-financeiro', texto: CATEGORIAS[c.categoria] || c.categoria }),
        c.valor ? el('span', { class: 'valor', texto: c.valor }) : null,
        el('strong', { texto: c.nome || 'Sem nome' }),
        c.dataPagamento ? el('span', { class: 'suave pequeno', texto: `Pago em ${c.dataPagamento}` }) : null,
        c.descricao ? el('span', { class: 'suave pequeno', texto: `"${c.descricao}"` }) : null,
        el('span', { class: 'suave pequeno', texto: `${numero(c.telefone)} · recebido ${new Date(c.criadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` }),
        el('button', { onclick: () => abrirConversa(c.telefone) }, ['Abrir conversa', icone('direita')]),
      ]),
    ]));
  }
}
$('filtroComprovante').addEventListener('change', carregarComprovantes);

/* =================== Mensagens do robô =================== */
const SECOES_TEXTOS = [
  ['Dados da paróquia', [
    ['telefone', 'Telefone da paróquia', 'Aparece onde estiver escrito {telefone}.', true],
    ['pix', 'Chave PIX', 'Aparece onde estiver escrito {pix}.', true],
  ]],
  ['Boas-vindas e menu', [
    ['saudacao', 'Primeira mensagem', 'Enviada no primeiro contato. Deve pedir o nome da pessoa.'],
    ['prazer', 'Depois que a pessoa diz o nome', 'O menu principal é enviado logo em seguida.'],
    ['retorno', 'Quando a pessoa volta', 'Para quem já conversou antes. O menu principal vem em seguida.'],
    ['menu1', 'Menu principal', '1 Missas · 2 Confissões · 3 Intenção · 4 Batismo · 5 Casamento · 6 Certidões e Crisma · 7 Dízimo/doações/aluguéis · 8 Direção espiritual · 9 Secretaria'],
  ]],
  ['Missas, confissões e batismo', [
    ['missa', 'Horários de Missas', 'Opção 1 do menu principal.'],
    ['confissoes', 'Horários de Confissões', 'Opção 2 do menu principal.'],
    ['batismo', 'Batismo', 'Opção 4 do menu principal.'],
  ]],
  ['Intenção de Missa', [
    ['intencao', 'Pedido dos dados da intenção', 'Opção 3. A resposta da pessoa é registrada e enviada à Secretaria.'],
    ['intencaoRecebida', 'Intenção registrada', ''],
  ]],
  ['Casamento', [
    ['casamentoMenu', 'Menu de casamento', '1 Casamentos em 2027 · 2 Curso de Noivos · 3 Documentação (Jucilda)'],
    ['casamento2027', 'Casamentos em 2027', ''],
    ['cursoNoivos', 'Curso de Noivos', 'Pede os dados do casal; a resposta vai para a Jucilda.'],
  ]],
  ['Certidões e Crisma', [
    ['certidoesMenu', 'Menu de certidões', '1 Certidão de Batismo ou Casamento · 2 Registro de Crisma'],
    ['certidoes', 'Certidões de Batismo e Casamento', 'Pede os dados para localizar o registro; a resposta vai para a Jucilda.'],
    ['crisma', 'Registro de Crisma', 'Pede os dados da pessoa; a resposta vai para a Jucilda.'],
  ]],
  ['Dízimo, doações e aluguéis', [
    ['financeiro', 'Menu do financeiro', '1 Dízimo · 2 Doações · 3 Aluguel (Tiago) · 4 Falar com o financeiro (Tiago)'],
    ['dizimo', 'Dízimo', 'Deve explicar como contribuir e pedir a foto do comprovante.'],
    ['doacao', 'Doações', ''],
  ]],
  ['Direção espiritual e Secretaria', [
    ['direcaoEspiritual', 'Direção espiritual', 'Opção 8. Depois desta mensagem, a conversa vai para a Gabriela.'],
    ['secretaria', 'Dados da Secretaria', 'Opção 9. Depois desta mensagem, a conversa vai para a Gabriela.'],
  ]],
  ['Comprovantes e arquivos', [
    ['arquivoPergunta', 'Arquivo que não parece comprovante', '1 Comprovante · 2 Documentos e certidões (Jucilda) · 3 Outro assunto (recepção)'],
    ['comprovanteNome', 'Pedir o nome', 'Quando alguém que ainda não disse o nome envia um comprovante.'],
    ['comprovantePergunta', 'Perguntar o tipo', '1 Dízimo · 2 Doação · 3 Aluguel · 4 Não é comprovante (vai para a recepção)'],
    ['comprovanteRecebido', 'Comprovante recebido', 'Use {tipo} para "dízimo", "doação" ou "aluguel". A foto e o nome vão para o Tiago.'],
  ]],
  ['Atendimento humano', [
    ['transferencia', 'Passando para a Secretaria (Gabriela)', 'Opção 9, a palavra "atendente" ou arquivo de outro assunto.'],
    ['transferenciaDocumentos', 'Passando para Documentos (Jucilda)', 'Documentação de casamento ou arquivo de documento.'],
    ['transferenciaFinanceiro', 'Passando para o Financeiro (Tiago)', 'Aluguel ou "falar com o financeiro".'],
    ['solicitacaoEncaminhada', 'Dados recebidos e encaminhados', 'Depois de certidão, crisma ou curso de noivos. {tipo} = para quem foi.'],
    ['humano', 'Depois de 3 respostas inválidas', 'A conversa vai para a Secretaria.'],
    ['encerramentoHumano', 'Fim do atendimento humano', 'Enviada quando o atendente clica em "Encerrar".'],
  ]],
  ['Encerramento', [
    ['fim', 'Posso ajudar em algo mais?', '1 Sim (volta ao menu) · 2 Não (vai para a avaliação)'],
    ['pesquisa', 'Pedido de avaliação', 'A pessoa responde com uma nota de 1 a 5.'],
    ['agradecimento', 'Agradecimento pela avaliação', ''],
    ['tchau', 'Despedida sem avaliação', ''],
    ['agradecimentoContato', 'Quando a pessoa agradece', 'Resposta a "obrigado", "Deus abençoe" etc.'],
  ]],
  ['Mensagens automáticas', [
    ['opcaoInvalida', 'Opção inválida', 'Quando a pessoa digita algo que não é uma opção.'],
    ['audioNaoEntendido', 'Áudio que não deu para entender', 'Quando a transcrição do áudio falha.'],
    ['somenteTexto', 'Vídeo ou figurinha', 'O robô lê textos, áudios, fotos, PDFs e Word, mas não vídeos e figurinhas.'],
  ]],
];
let textosSalvos = null;
let versaoTextos = 0;

async function carregarTextos() {
  const caixa = $('camposTextos');
  if (textosSalvos && textosAlterados()) return; // não perde o que está sendo editado
  let dados;
  try { dados = await api('textos'); } catch (err) {
    caixa.replaceChildren(el('p', { class: 'erro', texto: err.message }));
    return;
  }
  textosSalvos = dados.textos || {};
  versaoTextos = dados.versao;
  $('textosInfo').textContent = dados.atualizadoEm
    ? `Última alteração: ${new Date(dados.atualizadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} por ${dados.atualizadoPor}.`
    : 'Aguardando o robô enviar os textos atuais.';
  caixa.replaceChildren();
  // textos que não estão em nenhuma seção (ex.: criados numa versão nova do robô) aparecem no fim
  const listados = new Set(SECOES_TEXTOS.flatMap(([, campos]) => campos.map(([id]) => id)));
  const outros = Object.keys(textosSalvos).filter((k) => !listados.has(k)).map((k) => [k, k, '']);
  const secoes = outros.length ? [...SECOES_TEXTOS, ['Outros textos', outros]] : SECOES_TEXTOS;
  for (const [titulo, campos] of secoes) {
    caixa.append(el('h3', { class: 'secao-textos', texto: titulo }));
    for (const [id, rotulo, ajuda, curto] of campos) {
      const campo = curto
        ? el('input', { id: `t_${id}`, 'data-campo': id })
        : el('textarea', { id: `t_${id}`, 'data-campo': id });
      campo.value = textosSalvos[id] || '';
      const previa = curto ? null : el('div', { class: 'bolha-previa', id: `p_${id}` });
      caixa.append(el('div', { class: 'campo-texto' }, [
        el('label', { for: `t_${id}`, texto: rotulo }),
        ajuda ? el('p', { class: 'ajuda', texto: ajuda }) : null,
        campo,
        previa ? el('div', { class: 'previa' }, [el('small', { class: 'suave', texto: 'Prévia no WhatsApp' }), previa]) : null,
      ]));
      campo.addEventListener('input', () => { ajustarCampo(campo); atualizarPrevia(campo); estadoTextos(); });
    }
  }
  document.querySelectorAll('[data-campo]').forEach((c) => { ajustarCampo(c); atualizarPrevia(c); });
  estadoTextos();
}

function ajustarCampo(c) {
  if (c.tagName !== 'TEXTAREA') return;
  c.style.height = 'auto';
  c.style.height = c.scrollHeight + 2 + 'px';
}
function atualizarPrevia(c) {
  const p = $(`p_${c.dataset.campo}`);
  if (!p) return;
  const v = (id) => $(`t_${id}`)?.value || '';
  const texto = c.value.replaceAll('{telefone}', v('telefone')).replaceAll('{pix}', v('pix'))
    .replaceAll('{nome}', 'Maria').replaceAll('{tipo}', 'dízimo');
  p.replaceChildren();
  formatarWhats(texto, p);
}
function lerTextos() {
  const t = { ...textosSalvos };
  document.querySelectorAll('[data-campo]').forEach((c) => { t[c.dataset.campo] = c.value; });
  return t;
}
function textosAlterados() {
  if (!textosSalvos) return false;
  return [...document.querySelectorAll('[data-campo]')].some((c) => (textosSalvos[c.dataset.campo] || '') !== c.value);
}
function estadoTextos(msg, erro = false) {
  const mudou = textosAlterados();
  $('btnSalvarTextos').disabled = !mudou;
  $('statusTextos').className = erro ? 'erro' : 'suave';
  $('statusTextos').textContent = msg || (mudou ? 'Alterações não salvas' : 'Tudo salvo');
}
$('btnSalvarTextos').addEventListener('click', async () => {
  const textos = lerTextos();
  const vazio = Object.entries(textos).find(([, v]) => !String(v).trim());
  if (vazio) {
    $(`t_${vazio[0]}`)?.focus();
    return estadoTextos('Preencha todos os campos antes de salvar.', true);
  }
  $('btnSalvarTextos').disabled = true;
  estadoTextos('Salvando...');
  try {
    const r = await api('textos', { metodo: 'PUT', corpo: { textos } });
    textosSalvos = textos;
    versaoTextos = r.versao;
    estadoTextos('Salvo. O robô passa a usar em poucos segundos.');
  } catch (err) {
    estadoTextos('Erro ao salvar: ' + err.message, true);
  }
});
window.addEventListener('beforeunload', (e) => { if (textosAlterados()) e.preventDefault(); });

/* =================== Atualização automática =================== */
let timers = [];
function iniciarAtualizacoes() {
  pararAtualizacoes();
  timers.push(setInterval(() => { if (estado.vista === 'atendimento') carregarMensagens(); }, 3000));
  timers.push(setInterval(carregarConversas, 5000));
  timers.push(setInterval(async () => {
    try { $('avisoRobo').hidden = (await api('eu')).roboOnline; } catch {}
  }, 30000));
}
function pararAtualizacoes() {
  timers.forEach(clearInterval);
  timers = [];
}

/* =================== Início =================== */
iniciarApp().catch(() => mostrarLogin());
