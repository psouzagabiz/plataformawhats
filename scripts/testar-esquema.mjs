// Testa garantirEsquema() contra o banco real. Todo "create table if not exists" e o seed
// condicional (só insere atendentes se a tabela estiver vazia) tornam isso seguro de rodar
// contra produção. Roda com: node --env-file=.env.local scripts/testar-esquema.mjs
import { garantirEsquema, banco } from '../lib/banco.js';

await garantirEsquema();
console.log('garantirEsquema() OK, sem erros.');
const sql = banco();
const [{ n }] = await sql`select count(*)::int as n from atendente`;
console.log(`Atendentes na tabela: ${n} (esperado: continuar 3, sem duplicar).`);
await sql.end();
