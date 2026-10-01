# Conector do WhatsApp (robô)

Processo contínuo que conecta um número de WhatsApp de verdade (via QR code, biblioteca
[Baileys](https://github.com/WhiskeySockets/Baileys) — o mesmo mecanismo do WhatsApp Web).
Roda **no computador da paróquia**, porque precisa ficar sempre ligado e conectado — a
Vercel não serve pra isso (funções serverless não ficam "ligadas").

## ⚠️ Avisos importantes

- **O computador precisa ficar ligado e com internet o tempo todo.** Se desligar, o
  WhatsApp para de responder até ele ligar de novo (o robô reconecta sozinho quando o
  computador voltar — não precisa reconfigurar nada).
- Baileys **não é oficial** — é engenharia reversa do protocolo do WhatsApp Web. Funciona
  bem pra atendimento normal, mas **números usados pra envio em massa agressivo correm
  risco real de serem bloqueados pelo WhatsApp**. Evite disparar a funcionalidade
  "Campanhas" do painel pra listas grandes de uma vez só nesse número — comece aos poucos.

## Passo a passo (uma vez só)

1. **Instalar o Node.js** nesse computador, se ainda não tiver: baixe em
   [nodejs.org](https://nodejs.org) (versão 20 ou mais recente, o botão "LTS") e instale
   normalmente (Avançar, Avançar, Concluir).
2. **Baixar o projeto**: se já tiver o Git instalado, abra o Prompt de Comando numa pasta
   de sua preferência e rode:
   ```
   git clone https://github.com/psouzagabiz/plataformawhats.git
   cd plataformawhats
   npm install
   ```
   Se não tiver Git, baixe o projeto como ZIP no GitHub (botão verde "Code" → "Download
   ZIP"), extraia, abra o Prompt de Comando dentro da pasta extraída e rode só `npm install`.
3. **Configurar os segredos**: dentro da pasta `robo`, copie o arquivo `.env.example` e
   renomeie a cópia para `.env`. Abra esse `.env` num editor de texto (Bloco de Notas
   serve) e preencha:
   - `POSTGRES_URL` — copie o valor de dentro da Vercel (Project Settings → Environment
     Variables → `POSTGRES_URL`).
   - `BOT_TOKEN` — copie o valor de dentro da Vercel (Project Settings → Environment
     Variables → `BOT_TOKEN`). Precisa ser **idêntico** ao que já está lá.
4. **Testar uma vez na mão**: dê duplo clique em `robo\iniciar-windows.bat`. Uma janela
   preta abre e mostra o andamento. Se aparecer erro de `.env` não encontrado, confira o
   passo 3. Deixe essa janela aberta por enquanto.
5. **Na Vercel**, adicione a variável `ROBO_CONECTOR_URL` apontando pra
   `http://localhost:3000` **não funciona** direto da internet — ver a seção "Como o
   painel acessa esse computador" abaixo antes desse passo.

## Como o painel (na internet) acessa esse computador

O computador da paróquia normalmente não tem um endereço fixo acessível de fora. A forma
mais simples de resolver isso é um túnel gratuito do [ngrok](https://ngrok.com/download):

1. Crie uma conta gratuita no ngrok e siga as instruções do site pra instalar e autenticar
   (`ngrok config add-authtoken ...`, o site mostra o comando certo com sua chave).
2. Com o conector já rodando (passo 4 acima), abra **outra** janela do Prompt de Comando e
   rode:
   ```
   ngrok http 3000
   ```
3. O ngrok mostra uma URL pública tipo `https://algumacoisa.ngrok-free.app` — é essa URL
   que vai em `ROBO_CONECTOR_URL` na Vercel.
4. **O endereço do ngrok muda toda vez que você reinicia ele** (no plano gratuito). Pra não
   precisar atualizar a Vercel toda hora, deixe o ngrok também ligando sozinho (mesma ideia
   do item "Ligar sozinho" abaixo) e evite fechá-lo sem necessidade.

## Ligar sozinho quando o computador ligar

1. Pressione `Windows + R`, digite `shell:startup` e aperte Enter — abre a pasta
   "Inicializar".
2. Copie o arquivo `robo\iniciar-windows-oculto.vbs` (ou crie um atalho dele) pra dentro
   dessa pasta.
3. Pronto: da próxima vez que o computador ligar e alguém entrar com o usuário do
   Windows, o conector sobe sozinho, sem abrir janela na tela. Pra conferir se está
   rodando, abra o Gerenciador de Tarefas e procure por "Node.js JavaScript Runtime".
4. Repita o mesmo processo pro `ngrok` (crie um atalho `ngrok http 3000` e coloque também
   na pasta Inicializar), ou deixe o ngrok como uma janela aberta de propósito se preferir
   acompanhar visualmente.

## Reconectar depois de um bloqueio/logout do WhatsApp

Se o número for desconectado do lado do WhatsApp (ex.: trocou de celular, deslogou todos os
aparelhos), o status volta pra "aguardando_qr" sozinho e o botão "Conectar WhatsApp" no
painel mostra um QR novo — não precisa reiniciar nada manualmente.

## Alternativas, se um dia quiserem sair do computador da paróquia

- **Oracle Cloud Always Free**: gratuito pra sempre, servidor que não dorme — exige mais
  configuração (é uma VM Linux de verdade), mas resolve o problema do endereço público sem
  precisar de ngrok.
- **Railway/Render/Fly.io**: pagos (ou com ressalvas no plano grátis — Render dorme depois
  de inatividade, o que derruba a conexão do WhatsApp), mas com deploy bem mais simples
  (conectar o GitHub e pronto). Me avisem se quiserem migrar pra um desses depois.
