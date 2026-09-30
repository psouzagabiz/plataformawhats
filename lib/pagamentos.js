// Assinatura paga via Stripe. Uma instituição só vira `paroquia.status = 'ativa'`
// depois que uma assinatura dela chega em `active`/`trialing` no Stripe — o webhook é a
// ÚNICA coisa que escreve nesse status a partir daqui (ver ARQUITETURA.md, adendo do
// painel matriz). `rota=checkout` (api/principal.js) só abre a sessão de pagamento;
// `api/webhook-stripe.js` é quem de fato confirma e libera o acesso.
import Stripe from 'stripe';
import { Erro400, Erro404 } from './erros.js';

let stripe;
function cliente() {
  if (!stripe) {
    const chave = process.env.STRIPE_SECRET_KEY;
    if (!chave) throw new Erro400('Pagamento ainda não configurado nesta instalação.');
    stripe = new Stripe(chave);
  }
  return stripe;
}

// Status do Stripe que liberam o acesso; qualquer outro (past_due, unpaid, canceled,
// incomplete_expired, incomplete) suspende — ver STATUS_SUSPENDEM abaixo.
const STATUS_ATIVAM = new Set(['active', 'trialing']);

export async function criarCheckout(sql, { paroquiaId, urlBase }) {
  const id = Number(paroquiaId);
  if (!id) throw new Erro400('Instituição inválida.');
  const [p] = await sql`select id, nome, contato_email, status from paroquia where id = ${id}`;
  if (!p) throw new Erro404('Instituição não encontrada.');
  if (p.status === 'ativa') return { jaAtiva: true };

  const precoId = process.env.STRIPE_PRICE_ID;
  if (!precoId) throw new Erro400('Pagamento ainda não configurado nesta instalação.');

  const [existente] = await sql`select stripe_customer_id from assinatura where paroquia_id = ${id}`;
  const sessao = await cliente().checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: precoId, quantity: 1 }],
    client_reference_id: String(id),
    customer: existente?.stripe_customer_id || undefined,
    customer_email: existente?.stripe_customer_id ? undefined : (p.contato_email || undefined),
    success_url: `${urlBase}/cadastro/confirmando?paroquiaId=${id}`,
    cancel_url: `${urlBase}/cadastro?paroquiaId=${id}&cancelado=1`,
    allow_promotion_codes: true,
  });
  return { url: sessao.url };
}

async function refletirStatusNaParoquia(sql, { paroquiaId, statusStripe }) {
  const statusParoquia = STATUS_ATIVAM.has(statusStripe) ? 'ativa' : 'suspensa';
  await sql`update paroquia set status = ${statusParoquia} where id = ${paroquiaId}`;
}

async function upsertAssinatura(sql, dados) {
  const { paroquiaId, customerId, subscriptionId, status, priceId, periodoFim } = dados;
  await sql`
    insert into assinatura (paroquia_id, stripe_customer_id, stripe_subscription_id, status, price_id, periodo_fim, atualizado_em)
    values (${paroquiaId}, ${customerId}, ${subscriptionId}, ${status}, ${priceId}, ${periodoFim}, now())
    on conflict (paroquia_id) do update set
      stripe_customer_id = excluded.stripe_customer_id,
      stripe_subscription_id = excluded.stripe_subscription_id,
      status = excluded.status,
      price_id = excluded.price_id,
      periodo_fim = excluded.periodo_fim,
      atualizado_em = now()
  `;
  await refletirStatusNaParoquia(sql, { paroquiaId, statusStripe: status });
}

async function paroquiaIdDaAssinatura(sql, subscriptionId) {
  const [linha] = await sql`select paroquia_id as "paroquiaId" from assinatura where stripe_subscription_id = ${subscriptionId}`;
  return linha?.paroquiaId ?? null;
}

// Chamado por api/webhook-stripe.js, já com a assinatura do evento verificada.
export async function processarEventoStripe(sql, evento) {
  const obj = evento.data.object;

  if (evento.type === 'checkout.session.completed') {
    const paroquiaId = Number(obj.client_reference_id);
    if (!paroquiaId || !obj.subscription) return;
    const assinatura = await cliente().subscriptions.retrieve(String(obj.subscription));
    await upsertAssinatura(sql, {
      paroquiaId,
      customerId: String(obj.customer),
      subscriptionId: assinatura.id,
      status: assinatura.status,
      priceId: assinatura.items.data[0]?.price?.id ?? null,
      periodoFim: new Date(assinatura.current_period_end * 1000),
    });
    return;
  }

  if (evento.type === 'customer.subscription.updated' || evento.type === 'customer.subscription.created') {
    let paroquiaId = await paroquiaIdDaAssinatura(sql, obj.id);
    if (!paroquiaId) return; // assinatura criada fora do fluxo de checkout.session.completed acima
    await upsertAssinatura(sql, {
      paroquiaId,
      customerId: String(obj.customer),
      subscriptionId: obj.id,
      status: obj.status,
      priceId: obj.items?.data?.[0]?.price?.id ?? null,
      periodoFim: new Date(obj.current_period_end * 1000),
    });
    return;
  }

  if (evento.type === 'customer.subscription.deleted') {
    const paroquiaId = await paroquiaIdDaAssinatura(sql, obj.id);
    if (!paroquiaId) return;
    await sql`update assinatura set status = 'canceled', atualizado_em = now() where paroquia_id = ${paroquiaId}`;
    await refletirStatusNaParoquia(sql, { paroquiaId, statusStripe: 'canceled' });
  }
}
