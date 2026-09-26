import { banco } from '../lib/banco.js';
const sql = banco();
console.log(await sql`select id, nome, status from paroquia`);
await sql.end();
