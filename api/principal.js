// API da plataforma de atendimento. Todas as rotas /api/* chegam aqui (ver vercel.json).
import { banco, garantirEsquema } from '../lib/banco.js';
import {
  hashSenha, conferirSenha, novoToken, hashToken, tokenIgual, ipDe, lerCookie,
  JANELA_MIN, MAX_FALHAS_IP, MAX_FALHAS_ATENDENTE,
} from '../lib/seguranca.js';
import { rotasAgenda } from '../lib/rotasAgenda.js';
import { executarRotina, processarResposta, registrarEntrega, descartarEnviosVencidos } from '../lib/confirmacao.js';
import { processarTeste } from '../lib/teste.js';

const SETORES = ['recepcao', 'documentos', 'financeiro'];
const DURACAO_SESSAO_DIAS = 7;
const MAX_MIDIA = 3 * 1024 * 1024; // limite de envio da Vercel (~4,5 MB com base64)
const TELEFONE = /^[0-9]{5,20}@(c\.us|lid)$/;

class Erro extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}
class Erro400 extends Erro { constructor(m) { super(400, m); } }
const limpa = (t, max) => String(t ?? '').trim().slice(0, max);
function exigeTelefone(t) {
  if (!TELEFONE.test(String(t))) throw new Erro400('Conversa inválida');
  return t;
}

function corpo(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { throw new Erro400('JSON inválido'); }
  }
  return req.body;
}

/* =================== AUTENTICAÇÃO =================== */
async function atendenteLogado(req) {
  const token = lerCookie(req, 'sessao');
  if (!token) return null;
  const sql = banco();
  // NOTA DE RECONSTRUÇÃO: a partir daqui (busca da sessão pelo hash do token,
  // validação de expiração, e o restante inteiro deste roteador — rotas de
  // /entrar, /sair, /senha, /atendentes, /eu, /conversas, /mensagens, /enviar,
  // /assumir, /encerrar, /transferir, /renomear, /midia, /nova, /prontas,
  // /comprovantes, /textos, /arquivo, além de despachar para rotasAgenda() e
  // processarTeste() — foi cortado pela API de leitura de arquivos da Vercel
  // (~27.4KB omitidos, sem paginação disponível). Este é o arquivo mais crítico
  // do backend e precisa ser reescrito do zero, com cuidado extra na lógica de
  // autenticação/sessão (comparar com seguranca.js, que foi recuperado por completo)
  // e validado contra o schema real do banco (Fase 0 do plano) antes de deploy.
}

export default async function handler(req, res) {
  throw new Error('principal.js incompleto — ver notas de reconstrução acima. Não fazer deploy deste arquivo como está.');
}
