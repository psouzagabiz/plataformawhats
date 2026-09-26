import { banco } from '../lib/banco.js';
const sql = banco();
for (const t of ['conversa', 'mensagem', 'comprovante', 'pronta', 'saida', 'conteudo']) {
  const [{ n }] = await sql`select count(*)::int as n from ${sql(t)} where paroquia_id is null`;
  console.log(t, 'sem paroquia_id:', n);
}
await sql.end();
