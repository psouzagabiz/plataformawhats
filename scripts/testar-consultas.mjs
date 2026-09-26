// Testes SOMENTE LEITURA das consultas mais arriscadas (joins, lateral, jsonb, arrays)
// contra o banco real, para achar erros de SQL antes de subir para produção.
// Roda com: node --env-file=.env.local scripts/testar-consultas.mjs
import { banco } from '../lib/banco.js';
import { roboOnline } from '../lib/presenca.js';
import { ATIVOS } from '../lib/agenda.js';

const sql = banco();
const [{ id: paroquiaId }] = await sql`select id from paroquia order by id limit 1`;
console.log('paroquiaId de teste:', paroquiaId);

const conversas = await sql`
  select c.telefone, c.nome, c.estado, c.setor,
    m.texto as ultima_texto, m.midia_id as ultima_midia, m.remetente as ultima_remetente, m.criado_em as ultima_em
  from conversa c
  left join lateral (
    select texto, midia_id, remetente, criado_em from mensagem where telefone = c.telefone order by id desc limit 1
  ) m on true
  order by coalesce(m.criado_em, c.atualizado_em) desc
  limit 5
`;
console.log('conversas (lateral join): OK,', conversas.length, 'linha(s)');

const [{ n }] = await sql`
  select count(*)::int as n from compromisso
  where paroquia_id = ${paroquiaId} and status = any(${ATIVOS})
`;
console.log('compromissos ativos (= any array): OK, n =', n);

const [conteudo] = await sql`select textos, versao from conteudo where id = 1`;
console.log('conteudo/textos (jsonb): OK,', conteudo ? 'linha existe' : 'sem linha ainda (esperado se robô nunca sincronizou)');

console.log('roboOnline():', await roboOnline(sql));

const comp = await sql`
  select c.*, p.nome as padre_nome from compromisso c left join padre p on p.id = c.padre_id
  where c.paroquia_id = ${paroquiaId} order by c.data, c.hora limit 3
`;
console.log('compromissos + padre (left join *): OK,', comp.length, 'linha(s)');

await sql.end();
console.log('Tudo certo.');
