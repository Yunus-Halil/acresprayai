# Start the local weed-vision service (ERFNet on CPU + RF-DETR Seg-Large on the GPU) from the ROCm environment.
#   npm run weed-vision:service          (or: powershell -ExecutionPolicy Bypass -File research\weed-vision-lab\scripts\serve_service.ps1)
# Runs in the foreground; Ctrl+C stops it. If Ctrl+C does not return (ROCm exit hang), close the window or
# Stop-Process the python process. The dev app needs VITE_WEED_VISION_PREVIEW=true for the /weed-vision-api proxy.
param(
  [string]$Python = "D:\swardus-research\rfdetr-exp7\venv-rocm\Scripts\python.exe",
  [int]$Port = 8765
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$lab = Split-Path -Parent $here
if (-not (Test-Path $Python)) { Write-Error "Python not found at $Python (the ROCm venv with flask, weedlab and rfdetr)"; exit 1 }
try {
  $h = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/weed-vision/health" -TimeoutSec 3
  Write-Output "A weed-vision service is already answering on port $Port (erfnet loaded: $($h.models.erfnet.loaded); rfdetr loaded: $($h.models.rfdetr.loaded))."
  exit 0
} catch { }
$env:PYTHONUTF8 = "1"; $env:PYTHONIOENCODING = "utf-8"
Set-Location $lab
Write-Output "Starting the weed-vision service on http://127.0.0.1:$Port/weed-vision (both models preload; the first start takes about 30 s)..."
& $Python -u scripts\serve_research_api.py --port $Port
