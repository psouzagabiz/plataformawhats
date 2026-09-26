// Backfill: preenche paroquia_id = 1 (a paróquia atual, já existente) em todas as linhas
// que já existiam antes das colunas novas (conversa, mensagem, comprovante, conteudo,
// pronta, saida). Roda com: node --env-file=.env.local scripts/migrar-multi-instituicao.mjs
// Só faz UPDATE ... WHERE paroquia_id IS NULL — idempotente, seguro de rodar mais de uma vez.
import { banco, garantirEsquema } from '../lib/banco.js';

await garantirEsquema();
const sql = banco();

const [{ id: paroquiaId }] = await sql`select id from paroquia order by id limit 1`;
console.log('Preenchendo paroquia_id =', paroquiaId, 'nas linhas antigas...');

const tabelas = ['conversa', 'mensagem', 'comprovante', 'pronta', 'saida'];
for (const t of tabelas) {
  const [{ n: antes }] = await sql`select count(*)::int as n from ${sql(t)} where paroquia_id is null`;
  const resultado = await sql`update ${sql(t)} set paroquia_id = ${paroquiaId} where paroquia_id is null`;
  console.log(`${t}: ${antes} linha(s) sem paroquia_id -> ${resultado.count} atualizada(s)`);
}

// conteudo é especial: tem unique(paroquia_id), então só atualiza se ainda não tiver ninguém com esse paroquia_id
const [existeConteudo] = await sql`select 1 from conteudo where paroquia_id = ${paroquiaId}`;
if (!existeConteudo) {
  const r = await sql`update conteudo set paroquia_id = ${paroquiaId} where paroquia_id is null`;
  console.log(`conteudo: ${r.count} atualizada(s)`);
} else {
  console.log('conteudo: já tem paroquia_id preenchido, nada a fazer.');
}

console.log('Concluído.');
await sql.end();
