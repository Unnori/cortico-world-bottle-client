# Notification-only media helper. No shell commands or network reads.
function Get-BottleSoundVolume([double]$Volume, [double]$PositionMs, [double]$DurationMs, [double]$FadeOutMs) {
  $level = [Math]::Max(0.0, [Math]::Min(1.0, $Volume))
  $fade = [Math]::Min([Math]::Max(0.0, $FadeOutMs), [Math]::Max(0.0, $DurationMs))
  if ($fade -gt 0 -and $DurationMs -gt 0) { $level *= [Math]::Max(0.0, [Math]::Min(1.0, ($DurationMs - $PositionMs) / $fade)) }
  return $level
}
function Stop-BottleSound {
  if ($script:soundTimer) { $script:soundTimer.Stop() }
  if ($script:soundPlayer) { try { $script:soundPlayer.Stop(); $script:soundPlayer.Close() } catch {} }
  $script:soundPlayer = $null
}
function Start-BottleSound($Settings) {
  if (-not $Settings -or -not $Settings.path) { return }
  Stop-BottleSound
  try {
    $file = [string]$Settings.path
    if (-not [System.IO.File]::Exists($file)) { return }
    $script:soundPlayer = [System.Windows.Media.MediaPlayer]::new()
    $script:soundBaseVolume = [Math]::Max(0.0, [Math]::Min(1.0, [double]$Settings.volume))
    $script:soundFadeMs = [Math]::Max(0.0, [Math]::Min(5000.0, [double]$Settings.fadeOutMs))
    $script:soundPlayer.Volume = $script:soundBaseVolume
    $script:soundTimer = [System.Windows.Threading.DispatcherTimer]::new()
    $script:soundTimer.Interval = [TimeSpan]::FromMilliseconds(25)
    $script:soundTimer.Add_Tick({
      try {
        $player = $script:soundPlayer
        if (-not $player) { return }
        if ($player.NaturalDuration.HasTimeSpan) {
          $duration = [Math]::Min(30000.0, $player.NaturalDuration.TimeSpan.TotalMilliseconds)
          $position = $player.Position.TotalMilliseconds
          if ($position -ge $duration) { Stop-BottleSound; return }
          $player.Volume = Get-BottleSoundVolume $script:soundBaseVolume $position $duration $script:soundFadeMs
        }
      } catch { Stop-BottleSound }
    })
    $script:soundPlayer.Add_MediaOpened({ $script:soundPlayer.Play(); $script:soundTimer.Start() })
    $script:soundPlayer.Add_MediaEnded({ Stop-BottleSound })
    $script:soundPlayer.Add_MediaFailed({ Stop-BottleSound })
    $script:soundPlayer.Open([Uri]::new($file))
  } catch { Stop-BottleSound }
}
