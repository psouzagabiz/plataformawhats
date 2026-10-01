' Liga o Cloudflare Tunnel em segundo plano, sem abrir janela na tela.
Set objShell = CreateObject("WScript.Shell")
caminhoBat = Replace(WScript.ScriptFullName, "iniciar-cloudflared-oculto.vbs", "iniciar-cloudflared.bat")
objShell.Run "cmd /c """ & caminhoBat & """", 0, False
