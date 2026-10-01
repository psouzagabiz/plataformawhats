' Liga o conector do WhatsApp em segundo plano, sem abrir janela preta na tela.
' Usado pelo atalho na pasta Inicializar do Windows (ver robo/README.md).
Set objShell = CreateObject("WScript.Shell")
caminhoBat = Replace(WScript.ScriptFullName, "iniciar-windows-oculto.vbs", "iniciar-windows.bat")
objShell.Run "cmd /c """ & caminhoBat & """", 0, False
