// Heartbeat do robô (conector local de WhatsApp da paróquia). O robô deve gravar
// `update presenca set visto_em = now() where quem = 'robo'` (upsert) periodicamente por
// alguma rota autenticada fora do escopo reconstruído aqui; consideramos ele "online" se o
// último sinal foi há menos de 2 minutos.
const LIMITE_MS = 2 * 60 * 1000;

export async function roboOnline(sql) {
  const [p] = await sql`select visto_em as "vistoEm" from presenca where quem = 'robo'`;
  if (!p) return false;
  return Date.now() - new Date(p.vistoEm).getTime() < LIMITE_MS;
}
