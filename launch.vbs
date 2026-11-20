' Data Dev Kit launcher
' Opens the local app in Edge / Chrome app mode, maximized by default.
' NOTE: keep this file ASCII-only (VBScript reads it as ANSI), so every path
'       is derived from the script location at runtime instead of hardcoded.
Option Explicit

Dim WshShell, fso, base, page, ps1, edge, chrome, sz, sw, sh, args

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

base = fso.GetParentFolderName(WScript.ScriptFullName)
page = "file:///" & Replace(base, "\", "/") & "/index.html"
ps1  = base & "\maximize.ps1"

If Not fso.FileExists(base & "\index.html") Then
  MsgBox "index.html was not found next to this script.", 16, "Data Dev Kit"
  WScript.Quit 1
End If

edge   = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"

sz = ScreenSize()
sw = sz(0)
sh = sz(1)

args = "--app=" & Chr(34) & page & Chr(34) & _
       " --start-maximized" & _
       " --window-position=0,0" & _
       " --window-size=" & sw & "," & sh & _
       " --disable-features=Translate"

If fso.FileExists(edge) Then
  WshShell.Run Chr(34) & edge & Chr(34) & " " & args, 1, False
ElseIf fso.FileExists(chrome) Then
  WshShell.Run Chr(34) & chrome & Chr(34) & " " & args, 1, False
Else
  ' No Chromium browser found: let the default browser open the page.
  WshShell.Run "rundll32.exe url.dll,FileProtocolHandler " & Chr(34) & page & Chr(34), 1, False
End If

' Edge app windows ignore --start-maximized, so force maximize once it opens.
If fso.FileExists(ps1) Then
  WshShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & ps1 & Chr(34), 0, False
End If

' ---------- helpers ----------
Function ScreenSize()
  Dim svc, items, it, mw, mh
  mw = 0
  mh = 0
  On Error Resume Next
  Set svc = GetObject("winmgmts:\\.\root\cimv2")
  Set items = svc.ExecQuery("SELECT CurrentHorizontalResolution, CurrentVerticalResolution FROM Win32_VideoController")
  For Each it In items
    If Not IsNull(it.CurrentHorizontalResolution) Then
      If it.CurrentHorizontalResolution > mw Then mw = it.CurrentHorizontalResolution
      If it.CurrentVerticalResolution > mh Then mh = it.CurrentVerticalResolution
    End If
  Next
  On Error GoTo 0
  If mw < 800 Then mw = 1920
  If mh < 600 Then mh = 1080
  ScreenSize = Array(mw, mh)
End Function