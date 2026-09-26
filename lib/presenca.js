// Heartbeat do robô (conector local de WhatsApp de cada instituição). O robô deve gravar
// `update presenca set visto_em = now() where quem = 'robo:<paroquiaId>'` (upsert)
// periodicamente por alguma rota autenticada fora do escopo reconstruído aqui;
// consideramos ele "online" se o último sinal foi há menos de 2 minutos.
//
// Compatibilidade: o robô real que já está em produção (código fora deste repositório,
// nunca visto nesta reconstrução) ainda escreve na chave antiga 'robo', sem instituição —
// por isso, para a instituição 1 (a paróquia atual), continuamos aceitando essa chave
// também, para não quebrar o indicador "Robô conectado" que já funciona hoje. Instituições
// novas (self-service) só terão o robô conectado depois que alguém configurar o conector
// local delas para usar a chave nova 'robo:<paroquiaId>' — isso é trabalho futuro.
const LIMITE_MS = 2 * 60 * 1000;

export async function roboOnline(sql, paroquiaId) {
  const chaves = paroquiaId === 1 ? [`robo:${paroquiaId}`, 'robo'] : [`robo:${paroquiaId}`];
  const [p] = await sql`select max(visto_em) as "vistoEm" from presenca where quem = any(${chaves})`;
  if (!p?.vistoEm) return false;
  return Date.now() - new Date(p.vistoEm).getTime() < LIMITE_MS;
}
