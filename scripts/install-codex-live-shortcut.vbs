Option Explicit

Dim fileSystem, shell, repositoryRoot, tauriRoot, releasePath, debugPath
Dim executablePath, shortcutPath, shortcut

Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

repositoryRoot = fileSystem.GetParentFolderName(fileSystem.GetParentFolderName(WScript.ScriptFullName))
tauriRoot = fileSystem.BuildPath(repositoryRoot, "desktop\overlay\src-tauri")
releasePath = fileSystem.BuildPath(tauriRoot, "target\release\codex-command-center-overlay.exe")
debugPath = fileSystem.BuildPath(tauriRoot, "target\debug\codex-command-center-overlay.exe")

If fileSystem.FileExists(releasePath) Then
  executablePath = releasePath
ElseIf fileSystem.FileExists(debugPath) Then
  executablePath = debugPath
Else
  WScript.Echo "Build the Codex Live overlay before installing its desktop shortcut."
  WScript.Quit 1
End If

shortcutPath = fileSystem.BuildPath(shell.SpecialFolders("Desktop"), "Codex Live.lnk")
Set shortcut = shell.CreateShortcut(shortcutPath)
shortcut.TargetPath = executablePath
shortcut.Arguments = ""
shortcut.WorkingDirectory = fileSystem.GetParentFolderName(executablePath)
shortcut.IconLocation = fileSystem.BuildPath(tauriRoot, "icons\icon.ico")
shortcut.Description = "Open Codex Live and manage its private local telemetry relay."
shortcut.Save

WScript.Echo "Codex Live shortcut installed."
