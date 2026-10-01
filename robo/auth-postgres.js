// Adapta o AuthenticationState do Baileys (normalmente salvo em arquivos locais, via
// useMultiFileAuthState) pra ler/escrever no Postgres (tabela whatsapp_sessao). Necessário
// porque o Railway pode recriar o filesystem a cada deploy — sem isso, seria preciso
// escanear o QR code de novo toda vez que o serviço reiniciasse.
import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';

export async function usePostgresAuthState(sql, paroquiaId) {
  const [linha] = await sql`select dados from whatsapp_sessao where paroquia_id = ${paroquiaId}`;
  const dados = linha ? JSON.parse(JSON.stringify(linha.dados), BufferJSON.reviver) : {};

  const creds = dados.creds || initAuthCreds();
  const keys = dados.keys || {};

  async function salvar() {
    const serializado = JSON.parse(JSON.stringify({ creds, keys }, BufferJSON.replacer));
    await sql`
      insert into whatsapp_sessao (paroquia_id, dados, atualizado_em)
      values (${paroquiaId}, ${sql.json(serializado)}, now())
      on conflict (paroquia_id) do update set dados = ${sql.json(serializado)}, atualizado_em = now()
    `;
  }

  return {
    state: {
      creds,
      keys: {
        get: async (tipo, ids) => {
          const resultado = {};
          for (const id of ids) {
            const valor = keys[tipo]?.[id];
            if (valor !== undefined) resultado[id] = valor;
          }
          return resultado;
        },
        set: async (dadosNovos) => {
          for (const tipo of Object.keys(dadosNovos)) {
            keys[tipo] = keys[tipo] || {};
            for (const id of Object.keys(dadosNovos[tipo])) {
              const valor = dadosNovos[tipo][id];
              if (valor === null || valor === undefined) delete keys[tipo][id];
              else keys[tipo][id] = valor;
            }
          }
          await salvar();
        },
      },
    },
    saveCreds: salvar,
  };
}
