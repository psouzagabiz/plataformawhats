/* Painel (tela inicial): resumo do dia montado só com dados que a plataforma já tem
(conversas, agenda, confirmações e comprovantes). Usa as funções de app.js. */
(() => {
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hojeISO = () => iso(new Date());
const emDias = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const TIPOS = { direcao: 'Direção espiritual', visita: 'Visita', bencao: 'Bênção', outro: 'Outro compromisso' };
const CATEGORIAS = { dizimo: 'Dízimo', doacao: 'Doação', aluguel: 'Aluguel' };
const SITUACOES = {
  agendado: 'Agendado', aguardando_confirmacao: 'Aguardando confirmação', confirmado: 'Confirmado',
  alteracao_solicitada: 'Alteração solicitada', cancelado_pela_pessoa: 'Cancelado pela pessoa', cancelado: 'Cancelado',
  desmarcado_sem_confirmacao: 'Desmarcado', realizado: 'Realizado',
};
const MESES =['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function indicador({ rotulo, ic, valor, nota, vista, atencao }) {
  return el(vista ? 'button' : 'div', {
    type: vista ? 'button' : null, class: `indicador${atencao ? ' atencao' : ''}`,
    'data-ir': vista || null, 'aria-label': vista ? `${rotulo}: ${valor}. Abrir` : null,
  }, [
    el('span', { class: 'rotulo' }, [icone(ic), rotulo]),
    el('span', { class: 'valor', texto: String(valor) }),
    nota ? el('span', { class: 'nota', texto: nota }) : null,
  ]);
}

async function carregar() {
  const hoje = hojeISO();
  $('painelData').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const [compromissos, resumo, comprovantes] = await Promise.all([
    api(`compromissos?${new URLSearchParams({ de: hoje, ate: emDias(7), status: 'ativos' })}`).catch(() => null),
    api('confirmacoes/resumo').catch(() => null),
    api('comprovantes').catch(() => null),
  ]);
  const conversas = estado.conversas || [];

  // números do dia
  const humanos = conversas.filter((c) => c.estado === 'humano');
  const esperandoEquipe = humanos.filter((c) => c.ultimaRemetente === 'cliente').length;
  const comRoboHoje = conversas.filter((c) => c.estado !== 'humano' && c.ultimaEm && iso(new Date(c.ultimaEm)) === hoje).length;
  const deHoje = (compromissos || []).filter((c) => c.data === hoje);
  const pendentes = resumo?.porStatus?.aguardando_confirmacao || 0;

  // frase de abertura
  const partes = [
    esperandoEquipe ? `${plural(esperandoEquipe, 'pessoa espera', 'pessoas esperam')} resposta da equipe` : 'Ninguém está esperando resposta da equipe',
    deHoje.length ? `${plural(deHoje.length, 'compromisso', 'compromissos')} na agenda de hoje` : 'nenhum compromisso na agenda de hoje',
  ];
  $('painelResumo').textContent = `${partes[0]} e ${partes[1]}.`;

  $('painelIndicadores').replaceChildren(
    indicador({ rotulo: 'Aguardando a equipe', ic: 'relogio', valor: esperandoEquipe, nota: 'fiéis esperando resposta', vista: 'atendimento', atencao: esperandoEquipe > 0 }),
    indicador({ rotulo: 'Em atendimento', ic: 'assumir', valor: humanos.length, nota: 'conversas com a equipe', vista: 'atendimento' }),
    indicador({ rotulo: 'Com o robô hoje', ic: 'robo', valor: comRoboHoje, nota: 'respondidas pelo robô', vista: 'atendimento' }),
    indicador({ rotulo: 'Compromissos hoje', ic: 'agenda', valor: compromissos ? deHoje.length : '—', nota: compromissos ? `${compromissos.length} nos próximos 7 dias` : 'agenda indisponível', vista: 'agenda' }),
    indicador({ rotulo: 'Confirmações abertas', ic: 'confirma', valor: resumo ? pendentes : '—', nota: 'aguardando resposta 1, 2 ou 3', vista: 'confirmacoes', atencao: pendentes > 0 }),
  );

  // chamados por setor: barra de uma cor só, com nome e número escritos
  const setores = Object.entries(SETORES).map(([id, s]) => ({ id, nome: s.nome, n: humanos.filter((c) => c.setor === id).length }));
  const maior = Math.max(1, ...setores.map((s) => s.n));
  $('painelSetores').replaceChildren(humanos.length
    ? el('div', { class: 'barras', role: 'list' }, setores.map((s) => el('div', {
      class: 'barra-linha', role: 'listitem', title: `${s.nome}: ${plural(s.n, 'chamado aberto', 'chamados abertos')}`,
    }, [
      el('span', { class: 'nome' }, [ponto(s.id), s.nome]),
      el('span', { class: 'barra-trilho', 'aria-hidden': 'true' }, el('span', { class: 'barra-valor', style: `width:${(s.n / maior) * 100}%` })),
      el('span', { class: 'numero', texto: String(s.n) }),
    ])))
    : vazio('Nenhum chamado aberto', 'Quando o robô passar uma conversa para a equipe, ela aparece aqui por setor.'));

  // próximos compromissos
  const caixaAgenda = $('painelAgenda');
  if (!compromissos) caixaAgenda.replaceChildren(el('p', { class: 'erro', texto: 'Não foi possível carregar a agenda. Tente abrir a tela Agenda.' }));
  else if (!compromissos.length) {
    caixaAgenda.replaceChildren(vazio('Nenhum compromisso nos próximos 7 dias', 'Cadastre direções espirituais, visitas e bênçãos na Agenda.',
      { texto: 'Abrir agenda', icone: 'agenda', onclick: () => document.querySelector('.nav[data-vista=agenda]').click() }));
  } else {
    caixaAgenda.replaceChildren(el('ul', { class: 'lista-simples' }, compromissos.slice(0, 7).map((c) => {
      const [, m, d] = c.data.split('-');
      return el('li', { class: `t-${c.tipo}` }, [
        el('span', { class: 'data-bloco' }, [el('b', { texto: String(Number(d)) }), el('span', { texto: c.data === hoje ? 'hoje' : MESES[Number(m) - 1] })]),
        el('span', { class: 'principal-item' }, [
          el('strong', { texto: TIPOS[c.tipo] || c.tipo }),
          el('span', { texto: [`às ${c.hora}`, c.pessoaNome, c.padreNome].filter(Boolean).join(', ') }),
        ]),
        el('span', { class: `situacao s-${c.status}`, texto: SITUACOES[c.status] || c.status }),
      ]);
    })));
  }

  // comprovantes recentes
  const caixaComp = $('painelComprovantes');
  if (!comprovantes) caixaComp.replaceChildren(el('p', { class: 'erro', texto: 'Não foi possível carregar os comprovantes.' }));
  else if (!comprovantes.length) caixaComp.replaceChildren(vazio('Nenhum comprovante ainda', 'Os comprovantes enviados pelo WhatsApp aparecem aqui.'));
  else {
    caixaComp.replaceChildren(el('ul', { class: 'lista-simples' }, comprovantes.slice(0, 4).map((c) => el('li', {}, [
      avatar(c.nome || 'Sem nome', c.telefone),
      el('span', { class: 'principal-item' }, [
        el('strong', { texto: c.nome || 'Sem nome' }),
        el('span', { texto: `${CATEGORIAS[c.categoria] || c.categoria}${c.valor ? `, ${c.valor}` : ''}` }),
      ]),
      el('span', { class: 'suave pequeno', texto: horaCurta(c.criadoEm) }),
    ]))));
  }
}

document.addEventListener('vista', (e) => { if (e.detail === 'painel') carregar().catch((err) => toast(err.message, 'erro')); });
})();
