// Conector do WhatsApp (Baileys) — processo contínuo, roda fora da Vercel (Railway).
// Reaproveita a lógica de negócio que já existe em lib/ (mesmo repositório), em vez de
// duplicá-la: banco() e garantirEsquema() de lib/banco.js, processarResposta/
// registrarEntrega/descartarEnviosVencidos de lib/confirmacao.js.
import http from 'node:http';
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { banco, garantirEsquema } from '../lib/banco.js';
import { processarResposta, registrarEntrega, descartarEnviosVencidos } from '../lib/confirmacao.js';
import { usePostgresAuthState } from './auth-postgres.js';

const PAROQUIA_ID = Number(process.env.PAROQUIA_ID || 1);
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN não configurado.');

await garantirEsquema();
const sql = banco();

let socketAtual = null;
let statusConexao = 'aguardando_qr'; // aguardando_qr | qr_pronto | conectado
let ultimoQrDataUrl = null;

async function conectar() {
  const { state, saveCreds } = await usePostgresAuthState(sql, PAROQUIA_ID);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ version, auth: state, logger: pino({ level: 'warn' }) });
  socketAtual = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      ultimoQrDataUrl = await QRCode.toDataURL(qr);
      statusConexao = 'qr_pronto';
    }
    if (connection === 'open') {
      statusConexao = 'conectado';
      ultimoQrDataUrl = null;
      console.log('[robo] conectado');
    }
    if (connection === 'close') {
      statusConexao = 'aguardando_qr';
      const codigo = lastDisconnect?.error?.output?.statusCode;
      const deveReconectar = codigo !== DisconnectReason.loggedOut;
      console.log('[robo] conexão fechada', codigo, 'reconectar:', deveReconectar);
      if (deveReconectar) setTimeout(conectar, 3000);
    }
  });

  // mensagens recebidas do fiel: upsert em conversa + insere em mensagem; se for 1/2/3,
  // tenta processar como resposta de confirmação de presença (lib/confirmacao.js).
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      try {
        if (msg.key.fromMe) continue;
        const telefone = msg.key.remoteJid;
        if (!telefone || telefone.endsWith('@g.us') || telefone === 'status@broadcast') continue;
        const texto = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const nome = msg.pushName || '';

        await sql`
          insert into conversa (telefone, nome, paroquia_id, atualizado_em)
          values (${telefone}, ${nome}, ${PAROQUIA_ID}, now())
          on conflict (telefone) do update set
            atualizado_em = now(),
            nome = coalesce(nullif(conversa.nome, ''), ${nome})
        `;
        await sql`
          insert into mensagem (telefone, remetente, autor, texto, paroquia_id)
          values (${telefone}, 'cliente', ${nome}, ${texto}, ${PAROQUIA_ID})
        `;

        const resposta = texto.trim();
        if (['1', '2', '3'].includes(resposta)) {
          await processarResposta({ origem: msg.key.id, telefone, resposta, paroquiaId: PAROQUIA_ID })
            .catch((e) => console.error('[robo] processarResposta', e));
        }
      } catch (e) {
        console.error('[robo] erro processando mensagem recebida', e);
      }
    }
  });
}

await conectar();

// laço de envio: drena a fila "saida" (ver api/principal.js) a cada poucos segundos
setInterval(async () => {
  if (statusConexao !== 'conectado' || !socketAtual) return;
  try {
    const pendentes = await sql`
      select * from saida where entregue_em is null and erro is null and paroquia_id = ${PAROQUIA_ID}
      order by id asc limit 20
    `;
    for (const s of pendentes) {
      const jid = s.telefone || (s.numero ? `${String(s.numero).replace(/\D/g, '')}@s.whatsapp.net` : null);
      if (!jid) { await registrarEntrega(s.id, { erro: 'sem telefone/numero de destino' }); continue; }
      try {
        if (s.midia_id) {
          const [m] = await sql`select tipo, dados from midia where id = ${s.midia_id}`;
          if (!m) throw new Error('mídia não encontrada');
          const buffer = Buffer.from(m.dados);
          const opcoes = m.tipo?.startsWith('image/') ? { image: buffer, caption: s.texto || undefined }
            : m.tipo?.startsWith('video/') ? { video: buffer, caption: s.texto || undefined }
            : m.tipo?.startsWith('audio/') ? { audio: buffer, mimetype: m.tipo, ptt: false }
            : { document: buffer, mimetype: m.tipo || 'application/octet-stream', fileName: s.nome_arquivo || 'arquivo' };
          const enviado = await socketAtual.sendMessage(jid, opcoes);
          await registrarEntrega(s.id, { msgId: enviado?.key?.id });
        } else {
          const enviado = await socketAtual.sendMessage(jid, { text: s.texto || '' });
          await registrarEntrega(s.id, { msgId: enviado?.key?.id });
        }
      } catch (e) {
        await registrarEntrega(s.id, { erro: String(e.message || e) }).catch(() => {});
      }
    }
    await descartarEnviosVencidos();
  } catch (e) {
    console.error('[robo] laço de envio', e);
  }
}, 3000);

// heartbeat: lib/presenca.js (já existente) lê isto pra mostrar "Robô conectado" no painel
setInterval(() => {
  sql`
    insert into presenca (quem, visto_em) values (${'robo:' + PAROQUIA_ID}, now())
    on conflict (quem) do update set visto_em = now()
  `.catch((e) => console.error('[robo] presenca', e));
}, 30000);

// servidor HTTP pro painel (api/principal.js, rota robo/qr) buscar o QR/status
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/qr' || req.method !== 'GET') {
    res.writeHead(404).end('not found');
    return;
  }
  if (req.headers['x-bot-token'] !== BOT_TOKEN) {
    res.writeHead(401).end('unauthorized');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: statusConexao,
    qrDataUrl: statusConexao === 'qr_pronto' ? ultimoQrDataUrl : null,
  }));
}).listen(process.env.PORT || 3000, () => {
  console.log('[robo] servidor de status na porta', process.env.PORT || 3000);
});
