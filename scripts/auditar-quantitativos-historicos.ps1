# Auditoria somente leitura.
# Nao reinicia container, nao altera volume do Postgres e nao imprime senha.
# Uso, na maquina Docker, na pasta destes dois arquivos:
#   powershell -ExecutionPolicy Bypass -File .\auditar-quantitativos-historicos.ps1

$ErrorActionPreference = 'Stop'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -Scope Global -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}
$container = if ($env:PG_CONTAINER) { $env:PG_CONTAINER } else { 'sistemma-postgres' }
$sqlPath = Join-Path $PSScriptRoot 'auditar-quantitativos-historicos.sql'
$saidaDir = Join-Path $PSScriptRoot 'saida-auditoria-quantitativos'
$remotoSql = '/tmp/auditar-quantitativos-historicos.sql'

if (-not (Test-Path -LiteralPath $sqlPath)) {
  throw "Arquivo SQL nao encontrado: $sqlPath"
}

$estado = (docker inspect -f '{{.State.Running}}' $container 2>$null)
if ($LASTEXITCODE -ne 0 -or $estado.Trim() -ne 'true') {
  throw "Container '$container' nao esta em execucao. Nao suba nem recrie nada por este script."
}

$user = (docker exec $container printenv POSTGRES_USER).Trim()
if ($LASTEXITCODE -ne 0 -or $user -notmatch '^[A-Za-z0-9_]+$') {
  throw 'Nao foi possivel ler o usuario do Postgres no container. A senha nao e exibida.'
}

New-Item -ItemType Directory -Force -Path $saidaDir | Out-Null

docker cp -- $sqlPath "${container}:${remotoSql}"
if ($LASTEXITCODE -ne 0) {
  throw 'Nao foi possivel copiar o SQL para a area temporaria do container.'
}

$falhas = New-Object System.Collections.Generic.List[string]

try {
  $lista = docker exec -e PGCLIENTENCODING=UTF8 $container psql -U $user -d postgres -Atqc "SELECT datname FROM pg_database WHERE datistemplate = false AND datname <> 'postgres' ORDER BY 1"
  if ($LASTEXITCODE -ne 0) {
    throw 'Falha ao listar bancos. Nenhum dado foi alterado.'
  }

  $bancos = @($lista -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -and $_ -notmatch 'wuzapi' })
  Write-Host "Bancos candidatos (padrao e contrato_* entram se tiverem coleta_dados): $($bancos -join ', ')"
  Write-Host 'Consulta READ ONLY. O container permanece no ar.'

  foreach ($db in $bancos) {
    if ($db -notmatch '^[A-Za-z0-9_]+$') {
      Write-Host "PULADO nome de banco fora do padrao esperado."
      continue
    }

    $remotoCsv = "/tmp/auditar-$db.csv"
    $arquivo = Join-Path $saidaDir ($db + '.csv')
    $erroTxt = Join-Path $saidaDir ($db + '.erro.txt')

    $temTabela = docker exec -e PGCLIENTENCODING=UTF8 $container psql -U $user -d $db -Atqc "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'coleta_dados'"
    if ($LASTEXITCODE -ne 0 -or $temTabela.Trim() -ne '1') {
      Write-Host "PULADO $db (sem tabela coleta_dados)"
      continue
    }

    Write-Host "LENDO $db"
    try {
      $saidaErro = docker exec -e PGCLIENTENCODING=UTF8 $container psql -U $user -d $db -q -v ON_ERROR_STOP=1 -f $remotoSql -o $remotoCsv 2>&1
      if ($LASTEXITCODE -ne 0) { throw ($saidaErro | Out-String) }

      docker cp -- "${container}:${remotoCsv}" $arquivo
      if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel copiar o CSV para fora do container.' }
    }
    catch {
      $falhas.Add($db)
      Set-Content -LiteralPath $erroTxt -Value $_.Exception.Message -Encoding utf8
      Write-Host "FALHA $db. O erro ficou em $erroTxt. Os outros bancos continuam."
      docker exec $container rm -f $remotoCsv 2>$null | Out-Null
      continue
    }

    docker exec $container rm -f $remotoCsv 2>$null | Out-Null
    if (-not (Test-Path -LiteralPath $arquivo)) {
      $falhas.Add($db)
      Set-Content -LiteralPath $erroTxt -Value 'O CSV nao apareceu na pasta de saida.' -Encoding utf8
      Write-Host "FALHA $db ao gravar o CSV. Os outros bancos continuam."
      continue
    }

    $bytes = [System.IO.File]::ReadAllBytes($arquivo)
    $temBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
    if (-not $temBom) {
      $bom = [byte[]](0xEF, 0xBB, 0xBF)
      [System.IO.File]::WriteAllBytes($arquivo, $bom + $bytes)
    }
    Write-Host "OK $db -> $arquivo"
  }
}
finally {
  docker exec $container sh -c 'rm -f /tmp/auditar-quantitativos-historicos.sql /tmp/auditar-*.csv' 2>$null | Out-Null
}

if ($falhas.Count -gt 0) {
  Write-Host "Concluido com falha em: $($falhas -join ', '). CSVs dos demais bancos estao em $saidaDir"
  exit 1
}

Write-Host "Concluido. CSVs em $saidaDir"
