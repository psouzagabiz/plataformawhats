// Notificação do Mercado Pago quando um Pix muda de status. Função própria (fora do
// roteador principal.js, que exige sessão) — autenticada por assinatura, não por cookie,
// no mesmo espírito de api/rotina.js.
import { banco, garantirEsquema } from '../lib/banco.js';
import { assinaturaValida, consultarPagamento } from '../lib/pix.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  try {
    const dataId = req.query['data.id'] || req.body?.data?.id;
    const valido = assinaturaValida({
      xSignature: req.headers['x-signature'],
      xRequestId: req.headers['x-request-id'],
      dataId: String(dataId || ''),
    });
    if (!valido) return res.status(401).json({ erro: 'Assinatura inválida' });

    await garantirEsquema();
    const sql = banco();

    const pagamento = await consultarPagamento(dataId);
    const status = pagamento.status === 'approved' ? 'pago' : pagamento.status;

    const [registro] = await sql`
      update pagamento_pix set status = ${status}, pago_em = case when ${status} = 'pago' then now() else pago_em end
      where mp_payment_id = ${String(dataId)}
      returning id, paroquia_id as "paroquiaId", telefone, valor_centavos as "valorCentavos", status
    `;
    if (!registro) return res.status(200).json({ ok: true, ignorado: true });

    if (status === 'pago') {
      const valor = (registro.valorCentavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      await sql`
        insert into comprovante (origem, telefone, categoria, valor, data_pagamento, descricao, paroquia_id)
        values ('pix', ${registro.telefone}, 'dizimo', ${valor}, ${new Date().toISOString().slice(0, 10)}, 'Pago via Pix (Mercado Pago)', ${registro.paroquiaId})
      `;
      await sql`
        insert into saida (tipo, telefone, texto, paroquia_id)
        values ('texto', ${registro.telefone}, ${'Recebemos seu Pix, obrigado! Deus abençoe. 🙏'}, ${registro.paroquiaId})
      `;
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[webhook-mercadopago]', e);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}
