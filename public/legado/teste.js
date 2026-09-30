/* Botão "Testar confirmação" (tela Confirmações). Não cria nem altera compromissos reais.
Usa as funções de app.js ($, api, el, icone, toast, formatarWhats, estado). */
(() => {
const EXPLICA = {
  'Confirmar presença': 'O compromisso passaria para CONFIRMADO, com data, hora e canal registrados, e não seria desmarcado no prazo.',
  'Solicitar alteração': 'O compromisso ficaria como ALTERAÇÃO SOLICITADA (sem mudar data e horário) e a secretaria receberia um aviso no WhatsApp.',
  'Cancelar compromisso': 'O compromisso seria registrado como CANCELADO PELA PESSOA, sem ser apagado, e a secretaria receberia um aviso.',
};
const quando = (ts) => new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const amanha = () => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
let consulta = null;

// ---------- janela ----------
const campo = (rotulo, input) => el('label', {}, [rotulo, input]);
const inNumero = el('input', { inputmode: 'tel', placeholder: '(62) 99999-8888' });
const inNome = el('input', { maxlength: '100' });
const inData = el('input', { type: 'date' });
const inHora = el('input', { type: 'time', value: '10:00' });
const inTipo = el('select', {}, [['direcao', 'Direção espiritual'], ['visita', 'Visita'], ['bencao', 'Bênção'], ['outro', 'Outro compromisso']]
  .map(([v, t]) => el('option', { value: v, texto: t })));
const inLocal = el('input', { maxlength: '150', placeholder: 'Ex.: Igreja Matriz' });
const previa = el('div');
const situacao = el('p', { class: 'suave pequeno' });
const btnPrevia = el('button', { type: 'button', class: 'secundario', texto: 'Ver prévia' });
const btnEnviar = el('button', { type: 'button', class: 'primario', texto: 'Enviar teste pelo WhatsApp' });
const dlg = el('dialog', { class: 'dialogo-largo', id: 'dlgTeste' }, [
  el('h2', { texto: 'Testar confirmação de presença' }),
  el('p', { class: 'suave pequeno', texto: 'Mostra a mensagem exatamente como a pessoa vai receber, com o prazo calculado pelo expediente cadastrado. É só um teste: nenhum compromisso é criado ou alterado.' }),
  el('div', { class: 'grade-form' }, [
    campo('WhatsApp que vai receber o teste', inNumero),
    campo('Nome na mensagem', inNome),
    campo('Data do compromisso', inData),
    campo('Horário', inHora),
    campo('Tipo', inTipo),
    campo('Local', inLocal),
  ]),
  previa,
  situacao,
  el('div', { class: 'botoes' }, [
    el('button', { type: 'button', class: 'secundario', texto: 'Fechar', onclick: () => dlg.close() }),
    btnPrevia, btnEnviar,
  ]),
]);
dlg.addEventListener('close', () => { clearInterval(consulta); consulta = null; });
document.body.append(dlg);

const dados = () => ({ numero: inNumero.value, nome: inNome.value, data: inData.value, hora: inHora.value, tipo: inTipo.value, local: inLocal.value });

function desenharPrevia(r) {
  const bolha = el('div', { class: 'bolha-previa', style: 'max-width:100%;margin-top:12px' });
  formatarWhats(r.texto, bolha);
  const explicacao = el('p', { class: 'aviso-caixa', hidden: '' });
  previa.replaceChildren(
    el('p', { class: 'suave pequeno', style: 'margin:14px 0 0', texto: `Mensagem enviada a partir de ${quando(r.inicioEnvio)} · prazo para confirmar: ${quando(r.prazo)}. Veja o que acontece com cada resposta:` }),
    bolha,
    el('div', { style: 'display:grid;gap:4px;margin-top:4px;max-width:100%' }, r.respostas.map((b, i) => el('button', {
      type: 'button', class: 'secundario', texto: `${i + 1} - ${b}`,
      onclick: () => { explicacao.textContent = EXPLICA[b]; explicacao.hidden = false; },
    }))),
    explicacao,
    el('p', { class: 'suave pequeno', texto: 'Sem responder "1" (Confirmar presença) até o prazo, o compromisso é desmarcado automaticamente.' }),
  );
}

btnPrevia.addEventListener('click', async () => {
  situacao.textContent = '';
  try {
    const r = await api('teste', { metodo: 'POST', corpo: { ...dados(), acao: 'previa' } });
    if (r.erro) { situacao.textContent = 'Atenção: ' + r.erro; return; }
    desenharPrevia(r);
  } catch (e) { situacao.textContent = 'Atenção: ' + e.message; }
});

btnEnviar.addEventListener('click', async () => {
  btnEnviar.disabled = true;
  situacao.textContent = 'Colocando na fila do robô...';
  try {
    const r = await api('teste', { metodo: 'POST', corpo: { ...dados(), acao: 'enviar' } });
    if (r.texto) desenharPrevia(r);
    if (!r.naFila) {
      situacao.textContent = 'Não foi enviado: ' + (r.erro || 'erro desconhecido');
      return;
    }
    situacao.textContent = r.roboOnline
      ? 'Mensagem entregue ao robô, enviando pelo WhatsApp...'
      : 'Mensagem na fila, mas o robô (computador da paróquia) está desligado ou sem internet. Ela será enviada quando ele voltar (em até 1 hora).';
    clearInterval(consulta);
    consulta = setInterval(async () => {
      const t = await api(`teste?id=${r.id}`).catch(() => null);
      if (!t) return;
      if (t.resposta) {
        clearInterval(consulta);
        const rotulo = { confirmar: '1 - Confirmar presença', alterar: '2 - Solicitar alteração', cancelar: '3 - Cancelar compromisso' }[t.resposta];
        situacao.textContent = `Resposta recebida pela plataforma: "${rotulo}" às ${quando(t.respondidoEm)}. Confirmação funcionando!`;
      } else if (t.erro) {
        clearInterval(consulta);
        situacao.textContent = 'Não foi enviado: ' + t.erro;
      } else if (t.enviadoEm) {
        situacao.textContent = `Mensagem de teste enviada às ${quando(t.enviadoEm)}. Abra o WhatsApp e responda 1, 2 ou 3...`;
      }
    }, 3000);
  } catch (e) {
    situacao.textContent = 'Atenção: ' + e.message;
  } finally {
    btnEnviar.disabled = false;
  }
});

// ---------- botão na tela Confirmações ----------
document.querySelector('#vistaConfirmacoes .pagina-topo').append(el('button', {
  type: 'button', class: 'secundario',
  onclick: () => {
    if (!inData.value) inData.value = amanha();
    if (!inNome.value) inNome.value = estado.eu?.nome || '';
    previa.replaceChildren();
    situacao.textContent = '';
    dlg.showModal();
  },
}, [icone('teste'), 'Testar confirmação']));
})();
