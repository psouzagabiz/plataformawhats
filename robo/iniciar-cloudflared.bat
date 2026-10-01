@echo off
rem Abre o tunel publico gratuito (Cloudflare Tunnel) para o conector do WhatsApp.
rem Nao exige conta nem cadastro. A URL aparece no texto "Your quick Tunnel has been
rem created" — procure por algo como https://palavras-aleatorias.trycloudflare.com
rem Essa URL muda toda vez que esse script e reiniciado.
cd /d "%~dp0"
:loop
echo [%date% %time%] Iniciando o Cloudflare Tunnel...
cloudflared.exe tunnel --url http://localhost:3000
echo [%date% %time%] O tunel parou. Reiniciando em 5 segundos...
timeout /t 5 /nobreak >nul
goto loop
