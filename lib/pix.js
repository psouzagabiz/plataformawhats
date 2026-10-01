// Integração com a API de Pagamentos do Mercado Pago (cobrança Pix).
//
// Sem token configurado, criarCobranca() lança um erro claro em vez de tentar chamar a API
// — assim o resto da plataforma (campanhas, lembretes, entre paróquias) pode ser testado no
// preview sem depender do Mercado Pago estar pronto.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Erro400, Erro } from './erros.js';

const API = 'https://api.mercadopago.com/v1/payments';

export async function criarCobranca({ telefone, valorCentavos, paroquiaId }) {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) throw new Erro400('Pix ainda não configurado. Peça para configurarem o Mercado Pago.');
  if (!(valorCentavos > 0)) throw new Erro400('Valor inválido.');

  // Mercado Pago exige e-mail do pagador; só temos o WhatsApp, então sintetizamos um —
  // não é usado para contato, só preenche o campo obrigatório da API.
  const emailSintetico = `pix+${telefone.replace(/\D/g, '')}@paroquiano.app`;

  const resp = await fetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Idempotency-Key': `dizimo-${paroquiaId}-${telefone}-${Date.now()}`,
    },
    body: JSON.stringify({
      transaction_amount: Math.round(valorCentavos) / 100,
      payment_method_id: 'pix',
      description: 'Dízimo',
      payer: { email: emailSintetico },
    }),
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error('[pix] mercado pago recusou', resp.status, dados);
    throw new Erro(502, 'Não foi possível gerar o Pix agora. Tente novamente.');
  }
  const dadosPix = dados.point_of_interaction?.transaction_data || {};
  return {
    mpPaymentId: String(dados.id),
    status: dados.status === 'approved' ? 'pago' : 'pendente',
    qrCode: dadosPix.qr_code_base64 || null,
    copiaCola: dadosPix.qr_code || null,
  };
}

// Verifica a assinatura do webhook do Mercado Pago (cabeçalho x-signature).
// Documentação: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
//
// MERCADOPAGO_WEBHOOK_SECRET é opcional: só existe depois de configurar a URL de
// notificação na aba "Webhooks" do painel do Mercado Pago (é uma chave separada do Access
// Token/Client Secret). Sem ela configurada, pulamos a checagem de assinatura aqui — ainda
// é seguro porque webhookMercadoPago() sempre reconsulta o pagamento na API do Mercado Pago
// com o Access Token antes de marcar como pago, nunca confia só no corpo da notificação.
export function assinaturaValida({ xSignature, xRequestId, dataId }) {
  const segredo = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!segredo) return true; // sem chave configurada: a reconsulta na API é que protege
  if (!xSignature) return false;
  const partes = Object.fromEntries(
    xSignature.split(',').map((p) => p.trim().split('=').map((s) => s.trim()))
  );
  const { ts, v1 } = partes;
  if (!ts || !v1) return false;
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const esperado = createHmac('sha256', segredo).update(manifest).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(esperado, 'hex'));
  } catch {
    return false;
  }
}

export async function consultarPagamento(mpPaymentId) {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) throw new Error('Pix não configurado.');
  const resp = await fetch(`${API}/${mpPaymentId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Mercado Pago respondeu ${resp.status}`);
  return resp.json();
}
