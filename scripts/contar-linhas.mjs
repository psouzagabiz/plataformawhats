import { banco } from '../lib/banco.js';
const sql = banco();
for (const t of ['paroquia', 'atendente', 'conversa', 'mensagem', 'comprovante', 'pronta', 'saida', 'conteudo', 'compromisso']) {
  const [{ n }] = await sql`select count(*)::int as n from ${sql(t)}`;
  console.log(t, '=', n);
}
await sql.end();
