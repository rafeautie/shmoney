<#
.SYNOPSIS
    Rounds the corners of a PNG image with anti-aliased edges.

.USAGE
    powershell -File round-corners.ps1 -In <input.png> -Out <output.png> -Radius 16
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$In,

    [Parameter(Mandatory = $true)]
    [string]$Out,

    [Parameter(Mandatory = $false)]
    [int]$Radius = 16
)

Add-Type -AssemblyName System.Drawing

# Load the input fully into memory first so that the same path can be used
# for both -In and -Out (Image.FromFile keeps a file lock; a MemoryStream
# copy does not).
$inputBytes = [System.IO.File]::ReadAllBytes($In)
$inputStream = New-Object System.IO.MemoryStream(, $inputBytes)
$srcImage = [System.Drawing.Image]::FromStream($inputStream)

$width = $srcImage.Width
$height = $srcImage.Height
$r = $Radius

$destBitmap = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)

$graphics = [System.Drawing.Graphics]::FromImage($destBitmap)
try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    # Build a rounded-rectangle path out of four corner arcs joined by lines.
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2  # arc bounding-box diameter

    # Guard against a radius larger than half the image dimensions.
    $maxD = [Math]::Min($width, $height)
    if ($d -gt $maxD) { $d = $maxD }

    # Top-left corner
    $path.AddArc(0, 0, $d, $d, 180, 90)
    # Top-right corner
    $path.AddArc($width - $d, 0, $d, $d, 270, 90)
    # Bottom-right corner
    $path.AddArc($width - $d, $height - $d, $d, $d, 0, 90)
    # Bottom-left corner
    $path.AddArc(0, $height - $d, $d, $d, 90, 90)
    $path.CloseFigure()

    $brush = New-Object System.Drawing.TextureBrush($srcImage)
    try {
        $graphics.FillPath($brush, $path)
    }
    finally {
        $brush.Dispose()
    }

    $path.Dispose()
}
finally {
    $graphics.Dispose()
}

# Ensure the output directory exists.
$outDir = Split-Path -Path $Out -Parent
if ($outDir -and -not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}

# Save to a temp file first, then move into place, so overwriting the
# input path (In == Out) works even though we've already fully released
# the input's file handle via the MemoryStream load above.
$tempOut = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), [System.IO.Path]::GetRandomFileName() + '.png')
$destBitmap.Save($tempOut, [System.Drawing.Imaging.ImageFormat]::Png)

$destBitmap.Dispose()
$srcImage.Dispose()
$inputStream.Dispose()

Copy-Item -Path $tempOut -Destination $Out -Force
Remove-Item -Path $tempOut -Force
