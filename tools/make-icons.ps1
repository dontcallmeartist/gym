# Genera los iconos de la app a partir de icons/icono_gimnasio_1024.png
# Uso (PowerShell): ./tools/make-icons.ps1
Add-Type -AssemblyName System.Drawing
$dir = Join-Path $PSScriptRoot '..\icons'
$src = [System.Drawing.Image]::FromFile((Resolve-Path (Join-Path $dir 'icono_gimnasio_1024.png')))

function Save-Icon([int]$size, [string]$name, [double]$scale = 1.0) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Black)          # fondo del icono original
  $inner = [int][math]::Round($size * $scale)
  $off = [int](($size - $inner) / 2)
  $g.DrawImage($src, $off, $off, $inner, $inner)
  $g.Dispose()
  $bmp.Save((Join-Path $dir $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

Save-Icon 180 'apple-touch-icon.png'
Save-Icon 192 'icon-192.png'
Save-Icon 512 'icon-512.png'
Save-Icon 512 'icon-maskable-512.png' 0.8   # más pequeño: Android lo recorta en círculo
$src.Dispose()
Write-Output 'Iconos generados en icons/'
