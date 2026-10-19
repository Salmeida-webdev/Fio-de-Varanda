$ErrorActionPreference = "Stop"
$Projeto = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Projeto

$Porta = $null
foreach ($Candidata in 4280..4283) {
    $Listener = Get-NetTCPConnection -LocalPort $Candidata -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $Listener) {
        $Porta = $Candidata
        break
    }
    $EnderecoExistente = "http://localhost:$Candidata"
    try {
        $PaginaExistente = Invoke-WebRequest -Uri $EnderecoExistente -UseBasicParsing -TimeoutSec 3
        if ($PaginaExistente.StatusCode -eq 200 -and $PaginaExistente.Content -match 'app\.js\?v=37') {
            Start-Process $EnderecoExistente
            Write-Host "Prévia v37 já ativa: $EnderecoExistente"
            Write-Host "Painel administrativo: $EnderecoExistente/admin.html"
            exit 0
        }
    } catch { }
}
if ($null -eq $Porta) { throw "As portas 4280 a 4283 estão ocupadas. Feche uma prévia antiga e tente novamente." }
$Endereco = "http://localhost:$Porta"

$PythonLauncher = Get-Command py -ErrorAction SilentlyContinue
if ($PythonLauncher) {
    $Servidor = Start-Process -FilePath $PythonLauncher.Source -ArgumentList @("-m", "http.server", "$Porta") -WorkingDirectory $Projeto -WindowStyle Hidden -PassThru
} else {
    $Python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $Python) {
        throw "Python não foi encontrado. Instale o Python ou execute o preview com outro servidor local."
    }
    $Servidor = Start-Process -FilePath $Python.Source -ArgumentList @("-m", "http.server", "$Porta") -WorkingDirectory $Projeto -WindowStyle Hidden -PassThru
}

Start-Sleep -Seconds 2
Start-Process $Endereco
Write-Host "Prévia da loja: $Endereco"
Write-Host "Painel administrativo: $Endereco/admin.html"
Write-Host "Para encerrar o servidor, execute: Stop-Process -Id $($Servidor.Id)"
