/* Conexão do WhatsApp (QR code) — tela de Configurações e diálogo de pareamento.
Usa as funções de app.js ($, api, el, toast). */
(() => {
let timerQr = null;
let timerStatusConfig = null;

/* ---------- indicador na tela de Configurações ---------- */
async function atualizarStatusConfig() {
  let eu;
  try { eu = await api('eu'); } catch { return; }
  const conectado = !!eu.roboOnline;
  $('estadoRoboConfig').classList.toggle('desligado', !conectado);
  $('estadoRoboConfigTexto').textContent = conectado ? 'WhatsApp conectado' : 'WhatsApp desconectado';
}
document.addEventListener('vista', (e) => {
  clearInterval(timerStatusConfig);
  if (e.detail !== 'configuracoes') return;
  atualizarStatusConfig();
  timerStatusConfig = setInterval(atualizarStatusConfig, 10000);
});

/* ---------- diálogo de pareamento ---------- */
function pararPolling() { clearInterval(timerQr); timerQr = null; }

function mostrarEstado(status, qrDataUrl) {
  const moldura = $('roboQrMoldura');
  const img = $('roboQrImg');
  const check = $('roboCheck');
  const texto = $('roboStatusTexto');

  if (status === 'conectado') {
    moldura.classList.add('conectado');
    img.hidden = true;
    check.hidden = false;
    texto.textContent = 'WhatsApp conectado!';
    pararPolling();
    setTimeout(() => $('dlgConectarRobo').close(), 1800);
    atualizarStatusConfig();
    return;
  }

  moldura.classList.remove('conectado');
  check.hidden = true;
  if (status === 'qr_pronto' && qrDataUrl) {
    img.src = qrDataUrl;
    img.hidden = false;
    texto.textContent = 'Aponte a câmera do WhatsApp para o código acima.';
  } else {
    img.hidden = true;
    texto.textContent = 'Preparando o QR code…';
  }
}

async function buscarQr() {
  try {
    const r = await api('robo/qr');
    mostrarEstado(r.status, r.qrDataUrl);
  } catch (err) {
    $('roboStatusTexto').textContent = err.message;
    pararPolling();
  }
}

$('btnConectarRobo').addEventListener('click', () => {
  $('roboQrMoldura').classList.remove('conectado');
  $('roboQrImg').hidden = true;
  $('roboCheck').hidden = true;
  $('roboStatusTexto').textContent = 'Preparando o QR code…';
  $('dlgConectarRobo').showModal();
  buscarQr();
  timerQr = setInterval(buscarQr, 2000);
});

$('btnFecharRobo').addEventListener('click', () => {
  pararPolling();
  $('dlgConectarRobo').close();
});
$('dlgConectarRobo').addEventListener('close', pararPolling);
})();
