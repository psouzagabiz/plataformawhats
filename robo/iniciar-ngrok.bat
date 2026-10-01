@echo off
rem Abre o tunel publico (ngrok) para o conector do WhatsApp, e reabre sozinho se cair.
cd /d "%~dp0"
:loop
echo [%date% %time%] Iniciando o ngrok...
ngrok.exe http 3000 --log=stdout
echo [%date% %time%] O ngrok parou. Reiniciando em 5 segundos...
timeout /t 5 /nobreak >nul
goto loop
