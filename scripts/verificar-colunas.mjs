import { banco } from '../lib/banco.js';
const sql = banco();
const r = await sql`
  select table_name, column_name from information_schema.columns
  where table_schema='public' and column_name in ('papel','tipo','status','contato_nome','contato_email','paroquia_id')
  order by table_name, column_name
`;
for (const row of r) console.log(row.table_name, '.', row.column_name);
await sql.end();
