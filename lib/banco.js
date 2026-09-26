// Conexão com o Postgres (Supabase, conectado pela Vercel) e criação das tabelas.
import postgres from 'postgres';
import { hashSenha } from './seguranca.js';

let sql;
export function banco() {
  if (!sql) {
    const bruto = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    if (!bruto) throw new Error('Banco de dados não configurado (POSTGRES_URL ausente)');
    // parâmetros extras da URL do Supabase confundem o driver; o SSL é ligado abaixo
    const url = new URL(bruto);
    url.search = '';
    const local = ['localhost', '127.0.0.1'].includes(url.hostname); // banco de testes
    sql = postgres(url.toString(), {
      ssl: local ? false : 'require',
      prepare: false,       // necessário com o pooler (modo transação)
      max: Number(process.env.PG_MAX || 3),
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return sql;
}

// Atendentes iniciais (senha inicial 2607 — cada um pode trocar na plataforma)
const ATENDENTES = [
  { nome: 'Gabriela', setor: 'recepcao' },
  { nome: 'Jucilda', setor: 'documentos' },
  { nome: 'Tiago', setor: 'financeiro' },
];
const SENHA_INICIAL = '2607';

let pronto = null;
export function garantirEsquema() {
  if (!pronto) pronto = criar().catch((e) => { pronto = null; throw e; });
  return pronto;
}

async function criar() {
  const sql = banco();
  await sql.unsafe(`
    create table if not exists atendente (
      id serial primary key,
      nome text unique not null,
      setor text not null,

    -- NOTA DE RECONSTRUÇÃO: a partir daqui (definição completa da tabela "atendente" —
    -- provavelmente colunas de senha_hash, sessão, controle de tentativas — mais as
    -- tabelas de conversas, mensagens, agenda/compromissos, padres, comprovantes,
    -- mensagens prontas e textos do robô, e o seed usando ATENDENTES/SENHA_INICIAL)
    -- foi cortado pela API de leitura de arquivos da Vercel (~11.7KB omitidos, sem
    -- paginação disponível). O banco de dados real (Supabase) JÁ TEM essas tabelas
    -- criadas com dados de produção — este arquivo precisa ser reescrito consultando
    -- o schema real via information_schema (ver Fase 0 do plano) antes de qualquer
    -- alteração, nunca recriado às cegas.
  `);
}
