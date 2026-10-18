$Projeto = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Projeto
Write-Host "Prévia: http://localhost:4200"
Write-Host "Painel administrativo: http://localhost:4200/admin.html (login Supabase)"
if (Get-Command py -ErrorAction SilentlyContinue) {
    py -m http.server 4200
} else {
    python -m http.server 4200
}
