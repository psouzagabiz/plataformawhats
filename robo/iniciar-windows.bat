@echo off
rem Liga o conector do WhatsApp e o mantem rodando: se ele cair por qualquer motivo
rem (erro, queda de internet, Windows Update reiniciando algo), reinicia sozinho em
rem poucos segundos. Feche esta janela (ou use o "Parar" no atalho) pra desligar de vez.

cd /d "%~dp0.."

if not exist "robo\.env" (
  echo.
  echo ERRO: nao encontrei o arquivo robo\.env
  echo Copie robo\.env.example para robo\.env e preencha com os valores reais antes de continuar.
  echo.
  pause
  exit /b 1
)

:loop
echo [%date% %time%] Iniciando o conector do WhatsApp...
node --env-file=robo\.env robo\index.js
echo [%date% %time%] O conector parou. Reiniciando em 5 segundos... (feche esta janela pra desligar de vez)
timeout /t 5 /nobreak >nul
goto loop
