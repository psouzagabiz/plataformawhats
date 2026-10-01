// Motor de conversa do robô: saudação, coleta do nome, menu principal e submenus, até a
// transferência pra atendimento humano (ou o encerramento com pesquisa de satisfação).
// Os TEXTOS vêm da tabela `conteudo` (editados pela equipe na tela "Mensagens automáticas",
// ver public/app.js SECOES_TEXTOS) — este arquivo só decide QUANDO mandar qual texto.
//
// Fora de escopo por enquanto (ver conversa com a usuária): envio/recebimento de foto, PDF
// ou áudio continua apenas sendo registrado como mensagem vazia — o menu de "o que é esse
// arquivo" (arquivoPergunta/comprovantePergunta) e a transcrição de áudio não estão
// implementados ainda.

const MAX_TENTATIVAS_INVALIDAS = 3;

function preencher(texto, vars) {
  return String(texto || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

async function buscarTextos(sql, paroquiaId) {
  const [c] = await sql`select textos from conteudo where paroquia_id = ${paroquiaId}`;
  return c?.textos || {};
}

async function enviar(sql, paroquiaId, telefone, texto) {
  if (!texto) return;
  await sql`insert into mensagem (telefone, remetente, texto, paroquia_id) values (${telefone}, 'bot', ${texto}, ${paroquiaId})`;
  await sql`insert into saida (tipo, telefone, texto, paroquia_id) values ('bot', ${telefone}, ${texto}, ${paroquiaId})`;
}

async function moverPara(sql, paroquiaId, telefone, { etapa, setor = null, estado = null, tentativas = 0, nome }) {
  if (nome !== undefined) {
    await sql`
      update conversa set etapa = ${etapa}, setor = ${setor}, estado = ${estado},
        tentativas_invalidas = ${tentativas}, nome = ${nome}
      where telefone = ${telefone} and paroquia_id = ${paroquiaId}
    `;
  } else {
    await sql`
      update conversa set etapa = ${etapa}, setor = ${setor}, estado = ${estado}, tentativas_invalidas = ${tentativas}
      where telefone = ${telefone} and paroquia_id = ${paroquiaId}
    `;
  }
}

export async function processarMensagemCliente(sql, { paroquiaId, telefone, texto }) {
  const [c] = await sql`
    select nome, estado, setor, etapa, tentativas_invalidas as tentativas
    from conversa where telefone = ${telefone} and paroquia_id = ${paroquiaId}
  `;
  if (!c || c.estado === 'humano') return; // equipe já assumiu, o robô não interfere

  const T = await buscarTextos(sql, paroquiaId);
  const vars = { nome: c.nome || '', telefone: T.telefone || '', pix: T.pix || '', tipo: '' };
  const enviarT = (chave, extra) => enviar(sql, paroquiaId, telefone, preencher(T[chave], { ...vars, ...extra }));
  const resposta = (texto || '').trim();

  // Escape global: a palavra "atendente" transfere pra Secretaria em qualquer etapa.
  if (resposta.toLowerCase() === 'atendente') {
    await enviarT('transferencia');
    await moverPara(sql, paroquiaId, telefone, { etapa: null, setor: 'recepcao', estado: 'humano' });
    return;
  }

  // Encaminha pra atendimento humano depois de 3 respostas inválidas seguidas na mesma etapa.
  async function invalida(etapaAtual, reenviarMenu) {
    const tentativas = (c.tentativas || 0) + 1;
    if (tentativas >= MAX_TENTATIVAS_INVALIDAS) {
      await enviarT('humano');
      await moverPara(sql, paroquiaId, telefone, { etapa: null, setor: 'recepcao', estado: 'humano' });
      return;
    }
    await enviarT('opcaoInvalida');
    await reenviarMenu();
    await moverPara(sql, paroquiaId, telefone, { etapa: etapaAtual, setor: c.setor, estado: null, tentativas });
  }

  async function mandarMenuPrincipal() {
    await enviarT('menu1');
  }
  async function irParaMenuPrincipal() {
    await mandarMenuPrincipal();
    await moverPara(sql, paroquiaId, telefone, { etapa: 'menu_principal' });
  }
  async function irParaFim() {
    await enviarT('fim');
    await moverPara(sql, paroquiaId, telefone, { etapa: 'aguardando_fim' });
  }
  async function handoff(chave, setor) {
    if (chave) await enviarT(chave);
    await moverPara(sql, paroquiaId, telefone, { etapa: null, setor, estado: 'humano' });
  }

  // ----- Ponto de entrada: conversa nova ou retomada depois de um ciclo encerrado -----
  if (!c.etapa) {
    if (!c.nome) {
      await enviarT('saudacao');
      await moverPara(sql, paroquiaId, telefone, { etapa: 'aguardando_nome' });
    } else {
      await enviarT('retorno');
      await irParaMenuPrincipal();
    }
    return;
  }

  // ----- Coleta do nome -----
  if (c.etapa === 'aguardando_nome') {
    if (!resposta) return; // espera uma resposta de verdade antes de seguir
    const nome = resposta.slice(0, 120);
    await enviar(sql, paroquiaId, telefone, preencher(T.prazer, { ...vars, nome }));
    await mandarMenuPrincipal();
    await moverPara(sql, paroquiaId, telefone, { etapa: 'menu_principal', nome });
    return;
  }

  // ----- Menu principal (1 a 9) -----
  if (c.etapa === 'menu_principal') {
    switch (resposta) {
      case '1': await enviarT('missa'); return irParaFim();
      case '2': await enviarT('confissoes'); return irParaFim();
      case '3':
        await enviarT('intencao');
        return moverPara(sql, paroquiaId, telefone, { etapa: 'aguardando_intencao' });
      case '4': await enviarT('batismo'); return irParaFim();
      case '5':
        await enviarT('casamentoMenu');
        return moverPara(sql, paroquiaId, telefone, { etapa: 'menu_casamento' });
      case '6':
        await enviarT('certidoesMenu');
        return moverPara(sql, paroquiaId, telefone, { etapa: 'menu_certidoes' });
      case '7':
        await enviarT('financeiro');
        return moverPara(sql, paroquiaId, telefone, { etapa: 'menu_financeiro' });
      case '8':
        return handoff('direcaoEspiritual', 'recepcao');
      case '9':
        await enviarT('secretaria');
        return handoff('transferencia', 'recepcao');
      default:
        return invalida('menu_principal', mandarMenuPrincipal);
    }
  }

  // ----- Submenu: Casamento e Curso de Noivos -----
  if (c.etapa === 'menu_casamento') {
    switch (resposta) {
      case '1': await enviarT('casamento2027'); return irParaFim();
      case '2':
        await enviarT('cursoNoivos');
        return moverPara(sql, paroquiaId, telefone, { etapa: 'aguardando_curso_noivos' });
      case '3':
        return handoff('transferenciaDocumentos', 'documentos');
      default:
        return invalida('menu_casamento', () => enviarT('casamentoMenu'));
    }
  }

  // ----- Submenu: Certidões e Crisma -----
  if (c.etapa === 'menu_certidoes') {
    switch (resposta) {
      case '1':
        await enviarT('certidoes');
        return moverPara(sql, paroquiaId, telefone, { etapa: 'aguardando_certidao' });
      case '2':
        await enviarT('crisma');
        return moverPara(sql, paroquiaId, telefone, { etapa: 'aguardando_crisma' });
      default:
        return invalida('menu_certidoes', () => enviarT('certidoesMenu'));
    }
  }

  // ----- Submenu: Dízimo, doações e aluguéis -----
  if (c.etapa === 'menu_financeiro') {
    switch (resposta) {
      case '1': await enviarT('dizimo'); return irParaFim();
      case '2': await enviarT('doacao'); return irParaFim();
      case '3': return handoff('transferenciaFinanceiro', 'financeiro');
      case '4': return handoff('transferenciaFinanceiro', 'financeiro');
      default:
        return invalida('menu_financeiro', () => enviarT('financeiro'));
    }
  }

  // ----- Coleta de dados em uma única mensagem, depois bot encerra sozinho -----
  if (c.etapa === 'aguardando_intencao') {
    if (!resposta) return;
    await enviarT('intencaoRecebida');
    return irParaFim();
  }

  // ----- Coleta de dados que termina encaminhando pra Jucilda (Documentos) -----
  if (['aguardando_certidao', 'aguardando_crisma', 'aguardando_curso_noivos'].includes(c.etapa)) {
    if (!resposta) return;
    await enviarT('solicitacaoEncaminhada', { tipo: 'Jucilda, da Secretaria' });
    return handoff(null, 'documentos');
  }

  // ----- "Posso ajudar em algo mais?" -----
  if (c.etapa === 'aguardando_fim') {
    if (resposta === '1') return irParaMenuPrincipal();
    if (resposta === '2') {
      await enviarT('pesquisa');
      return moverPara(sql, paroquiaId, telefone, { etapa: 'aguardando_pesquisa' });
    }
    return invalida('aguardando_fim', () => enviarT('fim'));
  }

  // ----- Pesquisa de satisfação: encerra o ciclo (nome continua salvo pra próxima vez) -----
  if (c.etapa === 'aguardando_pesquisa') {
    if (!resposta) return;
    await enviarT('agradecimento');
    return moverPara(sql, paroquiaId, telefone, { etapa: null, nome: c.nome });
  }

  // etapa desconhecida (ex.: dado antigo) — recomeça do menu principal sem perder o nome
  await irParaMenuPrincipal();
}
