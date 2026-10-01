# Conector do WhatsApp (robô)

Processo contínuo que conecta um número de WhatsApp de verdade (via QR code, biblioteca
[Baileys](https://github.com/WhiskeySockets/Baileys) — o mesmo mecanismo do WhatsApp Web).
Roda fora da Vercel porque precisa ficar sempre ligado; a Vercel só hospeda o painel
(`../public`, `../api`).

## ⚠️ Aviso importante

Baileys **não é oficial** — é engenharia reversa do protocolo do WhatsApp Web. Isso
funciona bem pra atendimento normal, mas **números usados pra envio em massa agressivo
correm risco real de serem bloqueados pelo WhatsApp**. Evite disparar a funcionalidade
"Campanhas" do painel pra listas grandes de uma vez só nesse número — comece aos poucos e
observe. O projeto já tem credenciais da API oficial da Meta configuradas (sem risco de
bloqueio por volume), mas não ligadas a nada ainda — se o volume de campanhas crescer, vale
migrar pra elas no futuro.

## Deploy no Railway

1. Crie uma conta em [railway.app](https://railway.app) (se ainda não tiver) e conecte sua
   conta do GitHub.
2. **New Project → Deploy from GitHub repo** → escolha `psouzagabiz/plataformawhats`.
3. Em **Settings** do serviço criado:
   - **Root Directory**: deixe vazio/na raiz do repositório (**não** aponte para `robo` —
     o conector reaproveita `lib/banco.js` e `lib/confirmacao.js` da raiz do projeto, e as
     dependências de ambos ficam declaradas juntas no `package.json` da raiz por causa
     disso; apontar só para `robo/` quebra a instalação).
   - **Start Command**: `node robo/index.js`
4. Em **Variables**, adicione:
   - `POSTGRES_URL` — a mesma connection string do Supabase que a Vercel já usa (Project
     Settings → Environment Variables → `POSTGRES_URL`, na Vercel — copie o valor de lá).
   - `BOT_TOKEN` — **o mesmo valor** que já está configurado na Vercel (Project Settings →
     Environment Variables → `BOT_TOKEN`). Precisa ser idêntico dos dois lados: é o segredo
     que autentica a chamada do painel pra cá.
   - `PAROQUIA_ID` — `1` (a paróquia principal; deixe assim por enquanto, só existe uma
     instituição usando o robô de verdade).
5. Depois do primeiro deploy, o Railway mostra uma URL pública (algo como
   `https://paroquiano-robo-production.up.railway.app`). Copie essa URL.
6. Na Vercel, adicione a variável `ROBO_CONECTOR_URL` com essa URL (Project Settings →
   Environment Variables → New, target Production **e** Preview).
7. No painel (Configurações → Conexão do WhatsApp → "Conectar WhatsApp"), vai aparecer o QR
   code — escaneie com **WhatsApp → Aparelhos conectados → Conectar um aparelho**, no
   número que vai atender a paróquia.

## Reconectar depois de um bloqueio/logout

Se o número for desconectado do lado do WhatsApp (ex.: trocou de celular, deslogou todos os
aparelhos), o status volta pra "aguardando_qr" sozinho e o botão "Conectar WhatsApp" no
painel mostra um QR novo — não precisa reiniciar nada manualmente no Railway.

## Rodando localmente pra testar

```bash
npm install   # na raiz do repositório, não dentro de robo/
POSTGRES_URL="..." BOT_TOKEN="qualquercoisa" PAROQUIA_ID=1 node robo/index.js
```
