// Webhook do Stripe. Função separada de api/principal.js de propósito: precisa do corpo
// cru (sem JSON.parse) para verificar a assinatura (stripe.webhooks.constructEvent).
import Stripe from 'stripe';
import { banco, garantirEsquema } from '../lib/banco.js';
import { processarEventoStripe } from '../lib/pagamentos.js';

export const config = { api: { bodyParser: false } };

function lerCorpoCru(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    req.on('data', (c) => partes.push(c));
    req.on('end', () => resolve(Buffer.concat(partes)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const segredo = process.env.STRIPE_WEBHOOK_SECRET;
  const chave = process.env.STRIPE_SECRET_KEY;
  if (!segredo || !chave) return res.status(500).json({ erro: 'Webhook não configurado.' });

  const corpo = await lerCorpoCru(req);
  let evento;
  try {
    evento = new Stripe(chave).webhooks.constructEvent(corpo, req.headers['stripe-signature'], segredo);
  } catch (e) {
    return res.status(400).json({ erro: `Assinatura inválida: ${e.message}` });
  }

  try {
    await garantirEsquema();
    await processarEventoStripe(banco(), evento);
    res.status(200).json({ recebido: true });
  } catch (e) {
    // 500 faz o Stripe reenviar o evento depois — melhor que engolir o erro em silêncio.
    console.error('Erro processando webhook do Stripe', evento.type, e);
    res.status(500).json({ erro: 'Erro ao processar evento.' });
  }
}
