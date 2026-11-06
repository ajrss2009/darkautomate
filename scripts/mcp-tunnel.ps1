param(
  [int]$Port = 3333
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'release\win-unpacked\FilmForge.exe'
if (-not (Test-Path $exe)) { throw "FilmForge.exe nao encontrado em $exe. Rode o build/instale o app primeiro." }

$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)
if (-not $cloudflared) {
  $cloudflared = Get-ChildItem "$env:LOCALAPPDATA\npm-cache\_npx" -Recurse -Filter cloudflared.exe -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $cloudflared) {
  throw 'cloudflared nao encontrado. Instale com: winget install Cloudflare.cloudflared'
}

Write-Host "Iniciando FilmForge MCP HTTP na porta $Port..."
$app = Start-Process -FilePath $exe -ArgumentList @('--mcp-http', "$Port", '--mcp-host', '127.0.0.1') -PassThru -WindowStyle Hidden
try {
  $ok = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $r = Invoke-WebRequest "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch { }
  }
  if (-not $ok) { throw "O servidor MCP local nao respondeu em http://127.0.0.1:$Port/health" }

  $log = Join-Path $env:TEMP 'filmforge-cloudflared.log'
  Remove-Item $log -Force -ErrorAction SilentlyContinue
  Write-Host 'Abrindo tunel HTTPS temporario (Cloudflare Quick Tunnel)...'
  $tunnel = Start-Process -FilePath $cloudflared -ArgumentList @('tunnel', '--url', "http://127.0.0.1:$Port", '--no-autoupdate') -PassThru -WindowStyle Hidden -RedirectStandardError $log
  $url = $null
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Path $log) {
      $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches | Select-Object -First 1
      if ($m) { $url = $m.Matches[0].Value; break }
    }
  }
  if (-not $url) { throw "Nao foi possivel obter a URL do tunel. Veja $log" }

  Write-Host ''
  Write-Host '============================================================' -ForegroundColor Green
  Write-Host ' MCP do FilmForge pronto para ChatGPT / clientes remotos' -ForegroundColor Green
  Write-Host " URL do servidor: $url/mcp" -ForegroundColor Yellow
  Write-Host ' Autenticacao: Sem autenticacao' -ForegroundColor Yellow
  Write-Host '============================================================' -ForegroundColor Green
  Write-Host ''
  Write-Host 'No ChatGPT: Adicionar servidor MCP personalizado -> Conexao: URL do servidor -> cole a URL acima.' -ForegroundColor Cyan
  Write-Host 'Esta URL e temporaria e funciona enquanto esta janela estiver aberta.' -ForegroundColor DarkYellow
  Write-Host 'Pressione Ctrl+C para encerrar o app e o tunel.'
  while ($true) { Start-Sleep -Seconds 5 }
} finally {
  Write-Host 'Encerrando...'
  if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
  if ($app -and -not $app.HasExited) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue }
}
