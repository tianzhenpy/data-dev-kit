# Maximize the Data Dev Kit app window, and keep its title bar in sync with the app theme.
# The page appends U+200B to document.title when the dark theme is active.
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class MdWin {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int val, int size);
  [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref uint val, int size);
}
"@

$appMark = [string][char]0x6570 + [char]0x636E + [char]0x5F00 + [char]0x53D1 + [char]0x5DE5 + [char]0x5177 + [char]0x5305

function Find-AppWindow {
  Get-Process msedge -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like ('*' + $appMark + '*') } |
    Select-Object -First 1
}

function Set-Caption([IntPtr]$h, [bool]$dark) {
  $flag = 0; if ($dark) { $flag = 1 }
  [void][MdWin]::DwmSetWindowAttribute($h, 20, [ref]$flag, 4)
  [void][MdWin]::DwmSetWindowAttribute($h, 19, [ref]$flag, 4)
  $color = [uint32]0xFFFFFFFF
  if ($dark) { $color = [uint32]0x0027211E }
  [void][MdWin]::DwmSetWindowAttribute($h, 35, [ref]$color, 4)
}

$deadline = (Get-Date).AddSeconds(40)
$p = $null
while ((Get-Date) -lt $deadline) {
  $p = Find-AppWindow
  if ($p) { break }
  Start-Sleep -Milliseconds 200
}
if (-not $p) { exit }

$h = $p.MainWindowHandle
if (-not [MdWin]::IsZoomed($h)) { [void][MdWin]::ShowWindow($h, 3) }
Start-Sleep -Milliseconds 400
if (-not [MdWin]::IsZoomed($h)) { [void][MdWin]::ShowWindow($h, 3) }
[void][MdWin]::SetForegroundWindow($h)

$current = -1
$missing = 0
while ($true) {
  $p = Find-AppWindow
  if (-not $p) {
    $missing = $missing + 1
    if ($missing -ge 8) { break }
    Start-Sleep -Milliseconds 700
    continue
  }
  $missing = 0
  $h = $p.MainWindowHandle
  $title = [string]$p.MainWindowTitle
  $zwsp = [string][char]0x200B
  $dark = 0; if ($title.EndsWith($zwsp)) { $dark = 1 }
  if ($current -ne $dark) {
    Set-Caption $h ([bool]$dark)
    $current = $dark
  }
  Start-Sleep -Milliseconds 700
}