' Liga o tunel do ngrok em segundo plano, sem abrir janela na tela.
Set objShell = CreateObject("WScript.Shell")
caminhoBat = Replace(WScript.ScriptFullName, "iniciar-ngrok-oculto.vbs", "iniciar-ngrok.bat")
objShell.Run "cmd /c """ & caminhoBat & """", 0, False
