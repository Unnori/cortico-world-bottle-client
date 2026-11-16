# One hidden process owns the native cards. Snapshot order is oldest to newest.
param(
  [Parameter(Mandatory = $true)][string]$Data,
  [Parameter(Mandatory = $true)][string]$Base,
  # Isolated validation only: create cards off screen and report their layout.
  [switch]$PreviewOnly,
  [string]$Report = '',
  [int]$ExitAfterMs = 0
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Net.Http
$script:renderer = Join-Path $PSScriptRoot 'card-host.ps1'
$script:entries = @{}
$script:dismissed = @{}
$script:order = @()
$script:lastSnapshot = ''
$script:closing = $false
$script:preview = $PreviewOnly
$script:appearance = $null
$script:client = [System.Net.Http.HttpClient]::new()
$script:client.Timeout = [TimeSpan]::FromSeconds(1)
$script:request = $null
$script:nextTheme = [DateTime]::MinValue
$script:app = [System.Windows.Application]::new()
$script:app.ShutdownMode = 'OnExplicitShutdown'

function Update-StackLayout {
  $wa = [System.Windows.SystemParameters]::WorkArea
  $bottom = $wa.Bottom - 8
  for ($i = $script:order.Count - 1; $i -ge 0; $i--) {
    $entry = $script:entries[$script:order[$i]]
    if (-not $entry) { continue }
    $win = $entry.Window
    $win.UpdateLayout()
    $height = $win.ActualHeight
    $top = $bottom - $height
    # Keep the newest cards visible. Hidden older cards retain their original order.
    $fits = $top -ge $wa.Top
    if ($fits) {
      $win.Left = if ($script:preview) { -4000 } else { [Math]::Max($wa.Left, $wa.Right - $win.ActualWidth - 8) }
      $win.Top = if ($script:preview) { -4000 - $bottom } else { $top }
      if (-not $win.IsVisible) { $win.Show() }
    } elseif ($win.IsVisible) { $win.Hide() }
    $entry.LayoutTop = $top
    $entry.Fits = $fits
    $bottom = $top + 18 # The renderer already includes shadow padding.
  }
}

function Remove-StackCard([string]$key) {
  $entry = $script:entries[$key]
  if (-not $entry) { return }
  $entry.Replacing = $true
  $entry.Window.Close()
  $script:entries.Remove($key)
  Remove-Module $entry.Module -Force -ErrorAction SilentlyContinue
}

function Read-Stack {
  # Atomic writer; keep the previous UI if a local read temporarily fails.
  try { $raw = [System.IO.File]::ReadAllText($Data, [System.Text.Encoding]::UTF8) } catch { return }
  if ($raw -eq $script:lastSnapshot) { return }
  try { $snapshot = $raw | ConvertFrom-Json } catch { return }
  if ($snapshot.version -ne 2) { return }
  $script:lastSnapshot = $raw
  $script:order = @($snapshot.cards | ForEach-Object { [string]$_.key })
  foreach ($key in @($script:entries.Keys)) {
    if ($key -notin $script:order) { Remove-StackCard $key }
  }
  foreach ($card in @($snapshot.cards)) {
    if (-not $card) { continue }
    $key = [string]$card.key
    if ($script:dismissed[$key] -eq $card.revision) { continue }
    $old = $script:entries[$key]
    if ($old -and $old.Revision -eq $card.revision) { continue }
    Remove-StackCard $key
    # Each renderer retains its own script variables and WPF action handlers.
    $module = New-Module -ArgumentList @($script:renderer, $card, $script:preview) -ScriptBlock {
      param($renderer, $card, $preview)
      . $renderer -Base $card.base -SpecInput $card -Managed -AutoCloseMs $card.autoCloseMs -PreviewOnly:$preview
      Export-ModuleMember -Function Accept-Appearance, Apply-Appearance -Variable win
    }
    $win = $module.ExportedVariables['win'].Value
    $entry = @{Window = $win; Module = $module; Key = $key; Revision = $card.revision; Replacing = $false}
    $script:entries[$key] = $entry
    $win.Tag = $entry
    $win.Add_Closed({
      param($sender, $event)
      $entry = $sender.Tag
      if ($entry.Replacing -or $script:closing) { return }
      $script:entries.Remove($entry.Key)
      $script:dismissed[$entry.Key] = $entry.Revision
      [Console]::Out.WriteLine((@{type = 'closed'; key = $entry.Key; revision = $entry.Revision} | ConvertTo-Json -Compress))
      Remove-Module $entry.Module -Force -ErrorAction SilentlyContinue
      Update-StackLayout
    })
    if ($script:appearance) { & $module { param($value) Accept-Appearance $value; Apply-Appearance } $script:appearance }
    $win.Show()
    $win.UpdateLayout()
  }
  Update-StackLayout
  if ($script:preview) {
    [Console]::Out.WriteLine((@{type = 'layout'; cards = @($script:order | ForEach-Object {
      $entry = $script:entries[$_]
      if ($entry) { @{key = $_; revision = $entry.Revision; top = $entry.LayoutTop; height = $entry.Window.ActualHeight; fits = $entry.Fits} }
    })} | ConvertTo-Json -Compress -Depth 8))
  }
}

$script:timer = [System.Windows.Threading.DispatcherTimer]::new()
$script:timer.Interval = [TimeSpan]::FromMilliseconds(200)
$script:timer.Add_Tick({
  Read-Stack
  if ($script:request -and $script:request.IsCompleted) {
    try {
      $script:appearance = $script:request.GetAwaiter().GetResult() | ConvertFrom-Json
      foreach ($entry in @($script:entries.Values)) {
        & $entry.Module {param($value) Accept-Appearance $value; Apply-Appearance} $script:appearance
      }
    } catch { }
    $script:request = $null
  }
  if (-not $script:preview -and $script:entries.Count -gt 0 -and -not $script:request -and [DateTime]::UtcNow -ge $script:nextTheme) {
    $script:nextTheme = [DateTime]::UtcNow.AddSeconds(2)
    $script:request = $script:client.GetStringAsync($Base.TrimEnd('/') + '/appearance')
  }
  Update-StackLayout
})
$script:timer.Start()

if ($ExitAfterMs -gt 0) {
  $script:exitTimer = [System.Windows.Threading.DispatcherTimer]::new()
  $script:exitTimer.Interval = [TimeSpan]::FromMilliseconds($ExitAfterMs)
  $script:exitTimer.Add_Tick({
    $script:exitTimer.Stop()
    if ($Report) {
      $rows = @($script:order | ForEach-Object {
        $entry = $script:entries[$_]
        if ($entry) { @{key = $_; revision = $entry.Revision; top = $entry.LayoutTop; height = $entry.Window.ActualHeight; fits = $entry.Fits; title = $entry.Window.Title} }
      })
      [System.IO.File]::WriteAllText($Report, (ConvertTo-Json -InputObject $rows -Depth 8), [System.Text.UTF8Encoding]::new($false))
    }
    $script:closing = $true
    $script:app.Shutdown()
  })
  $script:exitTimer.Start()
}
try { Read-Stack; $script:app.Run() | Out-Null }
finally {
  $script:closing = $true
  $script:timer.Stop()
  foreach ($key in @($script:entries.Keys)) { Remove-StackCard $key }
  $script:client.Dispose()
}
