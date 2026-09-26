// Senhas, sessões e proteção contra tentativas repetidas.
import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export async function hashSenha(senha) {
  const sal = randomBytes(16);
  const hash = await scryptAsync(String(senha), sal, 32);
  return `scrypt$${sal.toString('hex')}$${hash.toString('hex')}`;
}

export async function conferirSenha(senha, guardado) {
  const [, salHex, hashHex] = String(guardado).split('$');
  if (!salHex || !hashHex) return false;
  const hash = await scryptAsync(String(senha), Buffer.from(salHex, 'hex'), 32);
  return timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

export const novoToken = () => randomBytes(32).toString('hex');
export const hashToken = (t) => createHash('sha256').update(String(t)).digest('hex');

export function tokenIgual(recebido, esperado) {
  if (!recebido || !esperado) return false;
  const h = (s) => createHash('sha256').update(String(s)).digest();
  return timingSafeEqual(h(recebido), h(esperado));
}

export function ipDe(req) {
  return String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'desconhecido';
}

export function lerCookie(req, nome) {
  const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${nome}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

// Tentativas de login: 5 erros por IP ou 10 por atendente em 15 minutos bloqueia.
// Usa a tabela "tentativa_login" (ip, atendente_id, criado_em) — ver lib/banco.js.
export const JANELA_MIN = 15;
export const MAX_FALHAS_IP = 5;
export const MAX_FALHAS_ATENDENTE = 10;

export async function bloqueado(sql, { ip, atendenteId }) {
  const desde = new Date(Date.now() - JANELA_MIN * 60 * 1000);
  const [porIp] = await sql`
    select count(*)::int as n from tentativa_login where ip = ${ip} and criado_em > ${desde}
  `;
  if (porIp.n >= MAX_FALHAS_IP) return true;
  if (atendenteId) {
    const [porAtendente] = await sql`
      select count(*)::int as n from tentativa_login where atendente_id = ${atendenteId} and criado_em > ${desde}
    `;
    if (porAtendente.n >= MAX_FALHAS_ATENDENTE) return true;
  }
  return false;
}

export async function registrarFalha(sql, { ip, atendenteId }) {
  await sql`insert into tentativa_login (ip, atendente_id) values (${ip}, ${atendenteId ?? null})`;
}

export async function limparFalhas(sql, atendenteId) {
  await sql`delete from tentativa_login where atendente_id = ${atendenteId}`;
}
