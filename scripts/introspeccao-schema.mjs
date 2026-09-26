// Introspecção SOMENTE LEITURA do schema real do banco de producao (Supabase).
// Nunca faz create/alter/insert/update/delete.
// Roda com:  node --env-file=.env.local scripts/introspeccao-schema.mjs
import postgres from 'postgres';

const bruto = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!bruto) {
  console.error('POSTGRES_URL ausente. Rode "vercel env pull .env.local" antes.');
  process.exit(1);
}
const url = new URL(bruto);
url.search = '';
const sql = postgres(url.toString(), { ssl: 'require', prepare: false, max: 1 });

try {
  const colunas = await sql`
    select table_name, column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public'
    order by table_name, ordinal_position
  `;
  const porTabela = {};
  for (const c of colunas) {
    (porTabela[c.table_name] ??= []).push(c);
  }
  for (const [tabela, cols] of Object.entries(porTabela)) {
    console.log(`\n## ${tabela}`);
    for (const c of cols) {
      console.log(`  ${c.column_name}  ${c.data_type}${c.is_nullable === 'NO' ? ' not null' : ''}${c.column_default ? ` default ${c.column_default}` : ''}`);
    }
  }
  console.log(`\nTotal de tabelas: ${Object.keys(porTabela).length}`);
} finally {
  await sql.end();
}
