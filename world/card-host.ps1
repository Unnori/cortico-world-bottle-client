# 漂流瓶 · 原生卡片
#
# 由 World 启动，读一份 JSON，画一张纸，按钮把动作回传给本地信箱服务，然后自己关。
# 显示、回传、关闭；新来信/回信可以播放一次本机音效，不读取网络音频。
param(
  [Parameter(Mandatory = $true)][string]$Data,
  [Parameter(Mandatory = $true)][string]$Base,
  # 没人理它时多久自己收起；调试时可以传小一点。
  [int]$AutoCloseMs = 10000,
  # 开发用：把窗口真实的样子截一张 PNG，然后照常运行。
  [string]$Shot = '',
  [int]$ShotDelayMs = 500,
  # 开发用：起来后自动触发一个动作，用来验证回传链路。
  [string]$AutoAction = '',
  # Render an isolated preview off screen without taking focus.
  [switch]$PreviewOnly
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
. (Join-Path $PSScriptRoot 'card-sound.ps1')

# 150% 缩放下也别糊；老系统上失败就算了。
try {
  Add-Type -Namespace BottleNative -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);' -ErrorAction Stop
  [BottleNative.Dpi]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null
} catch { }

$script:themeBrushes = @{}
$script:themeColors = @{}
function Brush([string]$hex) {
  if ($hex.StartsWith('@')) {
    $key = $hex.Substring(1)
    if ($script:themeBrushes.ContainsKey($key)) { return $script:themeBrushes[$key] }
    $value = $script:themeColors.$key
    if ($key -eq 'accent-text' -and $value -notmatch '^#[0-9a-fA-F]{6}$') { $value = $script:themeColors.accent }
    if (-not $value) { $value = '#25334f' }
    $brush = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.ColorConverter]::ConvertFromString($value))
    $script:themeBrushes[$key] = $brush
    return $brush
  }
  $color = [System.Windows.Media.Color][System.Windows.Media.ColorConverter]::ConvertFromString($hex)
  return [System.Windows.Media.SolidColorBrush]::new($color)
}

$spec = Get-Content -LiteralPath $Data -Raw -Encoding UTF8 | ConvertFrom-Json
$script:baseUrl = $Base.TrimEnd('/')
$script:themeKeys = @('paper','card','ink','muted','line','accent','seal','sea','soft','panel','on-accent','warning-bg','warning-line','warning-text','danger-text')
$script:themeData = $null
function Accept-Appearance($candidate) {
  if (-not $candidate -or -not $candidate.preference -or $candidate.preference.mode -notin @('system','light','dark')) { return }
  foreach ($mode in @('light','dark')) {
    $palette = $candidate.palettes.$mode
    foreach ($key in $script:themeKeys) { if ([string]$palette.$key -notmatch '^#[0-9a-fA-F]{6}$') { return } }
  }
  $script:themeData = $candidate
}
function Apply-Appearance {
  if (-not $script:themeData) { return }
  $mode = $script:themeData.preference.mode
  if ($mode -eq 'system') {
    $mode = 'light'
    try { if ((Get-ItemPropertyValue -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -Name AppsUseLightTheme -ErrorAction Stop) -eq 0) { $mode = 'dark' } } catch { }
  }
  $script:themeColors = $script:themeData.palettes.$mode
  foreach ($key in @($script:themeBrushes.Keys)) {
    $brush = $script:themeBrushes[$key]
    $value = $script:themeColors.$key
    if ($key -eq 'accent-text' -and $value -notmatch '^#[0-9a-fA-F]{6}$') { $value = $script:themeColors.accent }
    $color = [System.Windows.Media.ColorConverter]::ConvertFromString($value)
    if ($brush.Color -eq $color) { continue }
    $brush.BeginAnimation([System.Windows.Media.SolidColorBrush]::ColorProperty, $null)
    if ([System.Windows.SystemParameters]::ClientAreaAnimation -and $script:win -and $script:win.IsLoaded) {
      $fromColor = $brush.Color
      $brush.Color = $color
      $animation = [System.Windows.Media.Animation.ColorAnimation]::new($fromColor, $color, [System.Windows.Duration]::new([TimeSpan]::FromMilliseconds(220)))
      $animation.FillBehavior = 'Stop'
      $brush.BeginAnimation([System.Windows.Media.SolidColorBrush]::ColorProperty, $animation)
    } else { $brush.Color = $color }
  }
}
Accept-Appearance $spec.appearance
try { Accept-Appearance (Invoke-RestMethod -Uri ($script:baseUrl + '/appearance') -TimeoutSec 1 -UseBasicParsing) } catch { }
Apply-Appearance

$script:busy = $false
$script:closeTimer = $null
$script:buttons = New-Object System.Collections.ArrayList

$win = New-Object System.Windows.Window
$win.Title = '漂流瓶'
$win.Width = 460
$win.SizeToContent = 'Height'
$win.WindowStyle = 'None'
$win.ResizeMode = 'NoResize'
$win.AllowsTransparency = $true
$win.Background = [System.Windows.Media.Brushes]::Transparent
$win.Topmost = $true
$win.ShowInTaskbar = $false
$win.ShowActivated = $false
$win.WindowStartupLocation = 'Manual'
$win.Left = -4000
$win.Top = -4000
$win.Opacity = 0
$script:win = $win

$shell = New-Object System.Windows.Controls.Grid
$shell.Margin = [System.Windows.Thickness]::new(26)

$card = New-Object System.Windows.Controls.Border
$card.Background = Brush '@card'
$card.CornerRadius = [System.Windows.CornerRadius]::new(14)
$card.BorderBrush = Brush '@line'
$card.BorderThickness = [System.Windows.Thickness]::new(1)
$card.Padding = [System.Windows.Thickness]::new(24, 20, 24, 18)
$shadow = New-Object System.Windows.Media.Effects.DropShadowEffect
$shadow.BlurRadius = 22
$shadow.ShadowDepth = 6
$shadow.Direction = 270
$shadow.Opacity = 0.17
$shadow.Color = [System.Windows.Media.Color][System.Windows.Media.ColorConverter]::ConvertFromString('#3C2D19')
$card.Effect = $shadow
$slide = [System.Windows.Media.TranslateTransform]::new(0, 10)
$card.RenderTransform = $slide

$stack = New-Object System.Windows.Controls.StackPanel

$head = New-Object System.Windows.Controls.Grid
$head.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition)) | Out-Null
$auto = New-Object System.Windows.Controls.ColumnDefinition
$auto.Width = [System.Windows.GridLength]::Auto
$head.ColumnDefinitions.Add($auto) | Out-Null

$eyebrow = New-Object System.Windows.Controls.TextBlock
$eyebrow.Text = [string]$spec.eyebrow
$eyebrow.FontFamily = 'Microsoft YaHei'
$eyebrow.FontSize = 11
$eyebrow.Foreground = Brush '@accent-text'
$eyebrow.VerticalAlignment = 'Center'
$head.Children.Add($eyebrow) | Out-Null

$close = New-Object System.Windows.Controls.TextBlock
$close.Text = '×'
$close.FontFamily = 'Segoe UI'
$close.FontSize = 15
$close.Foreground = Brush '@muted'
$close.Cursor = 'Hand'
$close.Margin = [System.Windows.Thickness]::new(10, -4, 0, 0)
$close.VerticalAlignment = 'Top'
[System.Windows.Controls.Grid]::SetColumn($close, 1)
$script:brushInk = Brush '@seal'
$script:brushInkHover = Brush '@accent'
$script:brushGhost = Brush '#00FFFFFF'
$script:brushGhostHover = Brush '@soft'
$script:brushMuted = Brush '@muted'
$script:brushFaint = Brush '@muted'

$close.Add_MouseLeftButtonUp({ param($s, $e) $script:win.Close() })
$close.Add_MouseEnter({ param($s, $e) $s.Foreground = $script:brushMuted })
$close.Add_MouseLeave({ param($s, $e) $s.Foreground = $script:brushFaint })
$head.Children.Add($close) | Out-Null
$stack.Children.Add($head) | Out-Null

if ($spec.from) {
  $from = New-Object System.Windows.Controls.TextBlock
  $from.Text = [string]$spec.from
  $from.FontFamily = 'Microsoft YaHei'
  $from.FontSize = 12
  $from.Foreground = Brush '@muted'
  $from.Margin = [System.Windows.Thickness]::new(0, 3, 0, 12)
  $stack.Children.Add($from) | Out-Null
}

# 标题：来自谁之后、正文之前。和网页上的 .mail-topic / h2.title 同一个位置。
if ($spec.title) {
  $title = New-Object System.Windows.Controls.TextBlock
  $title.Text = [string]$spec.title
  $title.FontFamily = 'Microsoft YaHei'
  $title.FontSize = 15
  $title.FontWeight = 'SemiBold'
  $title.Foreground = Brush '@ink'
  $title.TextWrapping = 'Wrap'
  $title.Margin = [System.Windows.Thickness]::new(0, 0, 0, 10)
  $stack.Children.Add($title) | Out-Null
}

if ($spec.quote) {
  $quote = New-Object System.Windows.Controls.Border
  $quote.Background = Brush '@panel'
  $quote.CornerRadius = [System.Windows.CornerRadius]::new(10)
  $quote.Padding = [System.Windows.Thickness]::new(13, 10, 13, 10)
  $quote.Margin = [System.Windows.Thickness]::new(0, 0, 0, 14)
  $quoteStack = New-Object System.Windows.Controls.StackPanel
  $quoteLabel = New-Object System.Windows.Controls.TextBlock
  $quoteLabel.Text = [string]$spec.quote.label
  $quoteLabel.FontFamily = 'Microsoft YaHei'
  $quoteLabel.FontSize = 10.5
  $quoteLabel.Foreground = Brush '@muted'
  $quoteLabel.Margin = [System.Windows.Thickness]::new(0, 0, 0, 4)
  $quoteStack.Children.Add($quoteLabel) | Out-Null
  $quoteBody = New-Object System.Windows.Controls.TextBlock
  $quoteBody.Text = [string]$spec.quote.body
  $quoteBody.FontFamily = 'Microsoft YaHei'
  $quoteBody.FontSize = 12.5
  $quoteBody.LineHeight = 21
  $quoteBody.LineStackingStrategy = 'BlockLineHeight'
  $quoteBody.TextWrapping = 'Wrap'
  $quoteBody.TextTrimming = 'CharacterEllipsis'
  $quoteBody.MaxHeight = 86
  $quoteBody.Foreground = Brush '@ink'
  $quoteStack.Children.Add($quoteBody) | Out-Null
  $quote.Child = $quoteStack
  $stack.Children.Add($quote) | Out-Null
}

$body = New-Object System.Windows.Controls.TextBlock
$body.Text = [string]$spec.body
$body.FontFamily = 'Microsoft YaHei'
$body.FontSize = 15.5
$body.LineHeight = 27
$body.LineStackingStrategy = 'BlockLineHeight'
$body.TextWrapping = 'Wrap'
$body.Foreground = Brush '@ink'
$stack.Children.Add($body) | Out-Null

if ($spec.hints) {
  foreach ($hint in @($spec.hints)) {
    $hintBorder = New-Object System.Windows.Controls.Border
    $hintBorder.Background = Brush '@warning-bg'
    $hintBorder.BorderBrush = Brush '@warning-line'
    $hintBorder.BorderThickness = [System.Windows.Thickness]::new(1)
    $hintBorder.CornerRadius = [System.Windows.CornerRadius]::new(9)
    $hintBorder.Padding = [System.Windows.Thickness]::new(11, 7, 11, 7)
    $hintBorder.Margin = [System.Windows.Thickness]::new(0, 10, 0, 0)
    $hintText = New-Object System.Windows.Controls.TextBlock
    $hintText.Text = [string]$hint
    $hintText.FontFamily = 'Microsoft YaHei'
    $hintText.FontSize = 11.5
    $hintText.TextWrapping = 'Wrap'
    $hintText.Foreground = Brush '@warning-text'
    $hintBorder.Child = $hintText
    $stack.Children.Add($hintBorder) | Out-Null
  }
}

if ($spec.meta) {
  $meta = New-Object System.Windows.Controls.TextBlock
  $meta.Text = [string]$spec.meta
  $meta.FontFamily = 'Microsoft YaHei'
  $meta.FontSize = 11
  $meta.Foreground = Brush '@muted'
  $meta.Margin = [System.Windows.Thickness]::new(0, 12, 0, 0)
  $stack.Children.Add($meta) | Out-Null
}

$status = New-Object System.Windows.Controls.TextBlock
$status.FontFamily = 'Microsoft YaHei'
$status.FontSize = 11.5
$status.TextWrapping = 'Wrap'
$status.Foreground = Brush '@muted'
$status.Margin = [System.Windows.Thickness]::new(0, 10, 0, 0)
$status.Visibility = 'Collapsed'
$script:status = $status
$stack.Children.Add($status) | Out-Null

function Close-Soon([int]$ms) {
  if ($script:closeTimer) { $script:closeTimer.Stop() }
  $script:closeTimer = New-Object System.Windows.Threading.DispatcherTimer
  $script:closeTimer.Interval = [TimeSpan]::FromMilliseconds($ms)
  $script:closeTimer.Add_Tick({
    $script:closeTimer.Stop()
    $fade = [System.Windows.Media.Animation.DoubleAnimation]::new(1, 0, [System.Windows.Duration]::new([TimeSpan]::FromMilliseconds(150)))
    $script:win.BeginAnimation([System.Windows.Window]::OpacityProperty, $fade)
    $script:late = New-Object System.Windows.Threading.DispatcherTimer
    $script:late.Interval = [TimeSpan]::FromMilliseconds(170)
    $script:late.Add_Tick({ $script:late.Stop(); $script:win.Close() })
    $script:late.Start()
  })
  $script:closeTimer.Start()
}

function Invoke-CardAction([string]$id) {
  if ($script:busy) { return }
  if ($id -eq 'close') { Close-Soon 0; return }

  $script:busy = $true
  foreach ($b in $script:buttons) { $b.IsEnabled = $false }
  try {
    # 不用 Invoke-RestMethod：它可能走系统代理，回环地址不该经过代理。
    $client = New-Object System.Net.WebClient
    $client.Proxy = $null
    $client.Encoding = [System.Text.Encoding]::UTF8
    $client.Headers.Add('x-bottle', '1')
    $client.Headers.Add('x-bottle-surface', 'card')
    $raw = $client.UploadString("$($script:baseUrl)/$id", 'POST', '')
    $res = $raw | ConvertFrom-Json
    if ($res.message) {
      $script:status.Text = [string]$res.message
      $script:status.Visibility = 'Visible'
    }
    if ($res.ok -eq $true -and $res.close -eq $true) {
      Close-Soon 950
      return
    }
    if ($res.ok -ne $true) {
      foreach ($b in $script:buttons) { $b.IsEnabled = $true }
      $script:busy = $false
      return
    }
    foreach ($b in $script:buttons) { $b.IsEnabled = $true }
    $script:busy = $false
  } catch {
    $script:status.Text = '信箱没回音，稍后再试。'
    $script:status.Visibility = 'Visible'
    foreach ($b in $script:buttons) { $b.IsEnabled = $true }
    $script:busy = $false
  }
}

function New-Pill([string]$label, [string]$tone, [string]$id) {
  $pill = New-Object System.Windows.Controls.Border
  $pill.Tag = $id
  $pill.Uid = $tone
  $pill.CornerRadius = [System.Windows.CornerRadius]::new(17)
  $pill.Padding = [System.Windows.Thickness]::new(18, 8, 18, 8)
  $pill.Margin = [System.Windows.Thickness]::new(0, 0, 8, 0)
  $pill.BorderThickness = [System.Windows.Thickness]::new(1)
  $pill.Cursor = 'Hand'
  if ($tone -eq 'primary') {
    $pill.Background = $script:brushInk
    $pill.BorderBrush = $script:brushInk
    $fg = '@on-accent'
  } else {
    $pill.Background = $script:brushGhost
    $pill.BorderBrush = Brush '@line'
    $fg = '@muted'
  }
  $text = New-Object System.Windows.Controls.TextBlock
  $text.Text = $label
  $text.FontFamily = 'Microsoft YaHei'
  $text.FontSize = 13
  $text.Foreground = Brush $fg
  $pill.Child = $text
  $pill.Add_MouseLeftButtonUp({ param($s, $e) Invoke-CardAction ([string]$s.Tag) })
  $pill.Add_MouseEnter({ param($s, $e)
      if ($script:busy) { return }
      if ($s.Uid -eq 'primary') { $s.Background = $script:brushInkHover } else { $s.Background = $script:brushGhostHover }
    })
  $pill.Add_MouseLeave({ param($s, $e)
      if ($script:busy) { return }
      if ($s.Uid -eq 'primary') { $s.Background = $script:brushInk } else { $s.Background = $script:brushGhost }
    })
  [void]$script:buttons.Add($pill)
  return $pill
}

$actions = New-Object System.Windows.Controls.StackPanel
$actions.Orientation = 'Horizontal'
$actions.Margin = [System.Windows.Thickness]::new(0, 16, 0, 0)
foreach ($action in @($spec.actions)) {
  if (-not $action) { continue }
  $actions.Children.Add((New-Pill ([string]$action.label) ([string]$action.tone) ([string]$action.id))) | Out-Null
}
$stack.Children.Add($actions) | Out-Null

$card.Child = $stack
$shell.Children.Add($card) | Out-Null
$win.Content = $shell

$win.Add_KeyDown({ param($s, $e) if ($e.Key -eq 'Escape') { $script:win.Close() } })

$script:soundStarted = $false
$win.Add_ContentRendered({
  if ($PreviewOnly) { return }
  if (-not $script:soundStarted) { $script:soundStarted = $true; Start-BottleSound $spec.sound }
  $wa = [System.Windows.SystemParameters]::WorkArea
  $script:win.Left = [Math]::Max($wa.Left + 12, $wa.Right - $script:win.ActualWidth - 20)
  $script:win.Top = [Math]::Max($wa.Top + 12, $wa.Bottom - $script:win.ActualHeight - 20)

  $fade = [System.Windows.Media.Animation.DoubleAnimation]::new(0, 1, [System.Windows.Duration]::new([TimeSpan]::FromMilliseconds(180)))
  $script:win.BeginAnimation([System.Windows.Window]::OpacityProperty, $fade)

  $ease = New-Object System.Windows.Media.Animation.CubicEase
  $ease.EasingMode = 'EaseOut'
  $rise = [System.Windows.Media.Animation.DoubleAnimation]::new(10, 0, [System.Windows.Duration]::new([TimeSpan]::FromMilliseconds(240)))
  $rise.EasingFunction = $ease
  $slide.BeginAnimation([System.Windows.Media.TranslateTransform]::YProperty, $rise)
})

# Poll only the local appearance endpoint. Async IO never blocks reading or button clicks.
Add-Type -AssemblyName System.Net.Http
$script:themeClient = [System.Net.Http.HttpClient]::new()
$script:themeClient.Timeout = [TimeSpan]::FromSeconds(1)
$script:themeRequest = $null
$script:themeNext = [DateTime]::MinValue
$script:themeTimer = [System.Windows.Threading.DispatcherTimer]::new()
$script:themeTimer.Interval = [TimeSpan]::FromMilliseconds(500)
$script:themeTimer.Add_Tick({
  if ($script:themeRequest -and $script:themeRequest.IsCompleted) {
    try { Accept-Appearance (($script:themeRequest.GetAwaiter().GetResult()) | ConvertFrom-Json) } catch { }
    $script:themeRequest = $null
  }
  Apply-Appearance
  if (-not $script:themeRequest -and [DateTime]::UtcNow -ge $script:themeNext) {
    $script:themeNext = [DateTime]::UtcNow.AddSeconds(2)
    $script:themeRequest = $script:themeClient.GetStringAsync($script:baseUrl + '/appearance')
  }
})
$script:themeTimer.Start()
$win.Add_Closed({ Stop-BottleSound; $script:themeTimer.Stop(); $script:themeClient.Dispose() })

# 人类一直不理它也别永远压在最上面：默认十秒自己收起，0 为保持显示。
if ($AutoCloseMs -gt 0) { Close-Soon $AutoCloseMs }

if ($Shot) {
  Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue
  $script:shotTimer = New-Object System.Windows.Threading.DispatcherTimer
  $script:shotTimer.Interval = [TimeSpan]::FromMilliseconds([Math]::Max(500, $ShotDelayMs))
  $script:shotTimer.Add_Tick({
    $script:shotTimer.Stop()
    try {
      $bitmap = [System.Windows.Media.Imaging.RenderTargetBitmap]::new([int]$card.ActualWidth, [int]$card.ActualHeight, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
      $bitmap.Render($card)
      $encoder = [System.Windows.Media.Imaging.PngBitmapEncoder]::new()
      $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
      $stream = [System.IO.File]::Create($Shot)
      try { $encoder.Save($stream) } finally { $stream.Dispose() }
    } catch { }
  })
  $script:shotTimer.Start()
}

if ($AutoAction) {
  $script:autoTimer = New-Object System.Windows.Threading.DispatcherTimer
  $script:autoTimer.Interval = [TimeSpan]::FromMilliseconds(700)
  $script:autoTimer.Add_Tick({
    $script:autoTimer.Stop()
    Invoke-CardAction $AutoAction
  })
  $script:autoTimer.Start()
}

$app = New-Object System.Windows.Application
$app.ShutdownMode = 'OnMainWindowClose'
$app.Run($win) | Out-Null
