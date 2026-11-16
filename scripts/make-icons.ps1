Add-Type -AssemblyName System.Drawing

function New-RoundedPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function New-Icon([int]$size, [string]$path) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $scale = $size / 64.0
  $bg = New-RoundedPath 0 0 $size $size (14 * $scale)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point($size, $size)),
    [System.Drawing.ColorTranslator]::FromHtml('#fb923c'),
    [System.Drawing.ColorTranslator]::FromHtml('#ea580c'))
  $g.FillPath($brush, $bg)

  $bars = @(
    @(14, 18, 36, 8, 255, '#ffffff'),
    @(18, 29, 28, 8, 225, '#ffffff'),
    @(22, 40, 20, 8, 215, '#ffe4cc')
  )
  foreach ($b in $bars) {
    $bx = $b[0] * $scale; $by = $b[1] * $scale; $bw = $b[2] * $scale; $bh = $b[3] * $scale
    $barPath = New-RoundedPath $bx $by $bw $bh ($bh / 2)
    $col = [System.Drawing.ColorTranslator]::FromHtml($b[5])
    $barBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb([int]$b[4], $col.R, $col.G, $col.B))
    $g.FillPath($barBrush, $barPath)
    $barBrush.Dispose(); $barPath.Dispose()
  }

  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $brush.Dispose(); $bg.Dispose(); $g.Dispose(); $bmp.Dispose()
}

$root = Split-Path -Parent $PSScriptRoot
New-Icon 512 (Join-Path $root 'public\pwa-512.png')
New-Icon 192 (Join-Path $root 'public\pwa-192.png')
New-Icon 180 (Join-Path $root 'public\apple-touch-icon.png')
Write-Output 'iconos generados'
