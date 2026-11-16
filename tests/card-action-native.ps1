# Isolated off-screen renderer fixture; only synthetic loopback HTTP is used.
param(
  [Parameter(Mandatory = $true)][string]$Renderer,
  [Parameter(Mandatory = $true)][string]$Data,
  [Parameter(Mandatory = $true)][string]$Base,
  [Parameter(Mandatory = $true)][string]$Report,
  [int]$ActionAtMs = 500,
  [switch]$Idle
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework
$script:auditApp = [System.Windows.Application]::new()
$script:auditApp.ShutdownMode = 'OnExplicitShutdown'
$fixture = Get-Content -LiteralPath $Data -Raw -Encoding UTF8 | ConvertFrom-Json
. $Renderer -Base $Base -SpecInput $fixture -Managed -PreviewOnly -AutoCloseMs 1000
$script:auditClock = [System.Diagnostics.Stopwatch]::StartNew()
$script:auditClosedAt = $null
$win.Add_Closed({ $script:auditClosedAt = $script:auditClock.ElapsedMilliseconds })
if (-not $Idle) {
  $script:auditAction = [System.Windows.Threading.DispatcherTimer]::new()
  $script:auditAction.Interval = [TimeSpan]::FromMilliseconds($ActionAtMs)
  $script:auditAction.Add_Tick({
    $script:auditAction.Stop()
    Invoke-CardAction 'send'
  })
  $script:auditAction.Start()
}
$script:auditCheck = [System.Windows.Threading.DispatcherTimer]::new()
$script:auditCheck.Interval = [TimeSpan]::FromMilliseconds(6000)
$script:auditCheck.Add_Tick({
  $script:auditCheck.Stop()
  $out = @{
    visible = $script:win.IsVisible
    closedAtMs = $script:auditClosedAt
    status = $script:status.Text
    statusVisible = ($script:status.Visibility -eq 'Visible')
    busy = $script:busy
    closeTimerEnabled = $script:closeTimer.IsEnabled
    lateTimerEnabled = ($script:late -and $script:late.IsEnabled)
    buttonsEnabled = (@($script:buttons | Where-Object { -not $_.IsEnabled }).Count -eq 0)
  }
  [System.IO.File]::WriteAllText($Report, ($out | ConvertTo-Json -Compress), [System.Text.UTF8Encoding]::new($false))
  if ($script:win.IsVisible) { $script:win.Close() }
  $script:auditApp.Shutdown()
})
$script:auditCheck.Start()
$win.Show()
$script:auditApp.Run() | Out-Null
