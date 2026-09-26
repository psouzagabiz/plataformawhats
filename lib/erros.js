// Erros HTTP compartilhados pelas rotas da API.
export class Erro extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}
export class Erro400 extends Erro { constructor(m) { super(400, m); } }
export class Erro404 extends Erro { constructor(m = 'Não encontrado') { super(404, m); } }
