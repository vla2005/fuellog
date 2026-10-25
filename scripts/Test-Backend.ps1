[CmdletBinding()]
param(
    [string]$PostgresBin = 'C:\Program Files\PostgreSQL\18\bin'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$apiRoot = Join-Path $projectRoot 'api'
foreach ($program in @('initdb.exe', 'pg_ctl.exe', 'createdb.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $PostgresBin $program))) {
        throw "PostgreSQL 18 não encontrado em $PostgresBin. Informe -PostgresBin."
    }
}

$testRunPath = Join-Path $apiRoot ('target\postgres-tests-' + [guid]::NewGuid().ToString('N'))
$clusterPath = Join-Path $testRunPath 'data'
$passwordPath = Join-Path $testRunPath 'password.txt'
New-Item -ItemType Directory -Path $testRunPath -Force | Out-Null
$randomBytes = New-Object byte[] 32
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
$random.GetBytes($randomBytes)
$random.Dispose()
$password = [Convert]::ToBase64String($randomBytes)
[IO.File]::WriteAllText($passwordPath, $password)

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$listener.Stop()
$previous = @{}
foreach ($name in @('PGPASSWORD', 'FUELLOG_DB_URL', 'FUELLOG_DB_USER', 'FUELLOG_DB_PASSWORD')) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$started = $false
$testExitCode = 1
try {
    & (Join-Path $PostgresBin 'initdb.exe') -D $clusterPath -U fuellog_test --encoding=UTF8 --locale=C --auth=scram-sha-256 --pwfile=$passwordPath *> (Join-Path $testRunPath 'initdb.log')
    if ($LASTEXITCODE -ne 0) { throw "initdb falhou. Consulte $testRunPath\initdb.log" }
    Remove-Item -LiteralPath $passwordPath
    & (Join-Path $PostgresBin 'pg_ctl.exe') -D $clusterPath -l (Join-Path $testRunPath 'postgres.log') -o "-h 127.0.0.1 -p $port" -w start
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL de teste não iniciou. Consulte $testRunPath\postgres.log" }
    $started = $true
    $env:PGPASSWORD = $password
    & (Join-Path $PostgresBin 'createdb.exe') -h 127.0.0.1 -p $port -U fuellog_test fuellog_test
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível criar o banco descartável.' }
    $env:FUELLOG_DB_URL = "jdbc:postgresql://127.0.0.1:$port/fuellog_test"
    $env:FUELLOG_DB_USER = 'fuellog_test'
    $env:FUELLOG_DB_PASSWORD = $password
    Write-Host "PostgreSQL descartável na porta $port. Evidências: $testRunPath"
    & rtk proxy (Join-Path $apiRoot 'mvnw.cmd') -f (Join-Path $apiRoot 'pom.xml') -Pverification verify
    $testExitCode = $LASTEXITCODE
}
finally {
    if ($started) {
        & (Join-Path $PostgresBin 'pg_ctl.exe') -D $clusterPath -m fast -w stop
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Não foi possível confirmar parada do PostgreSQL de teste em $clusterPath."
            $testExitCode = 1
        }
    }
    if (Test-Path -LiteralPath $passwordPath) { Remove-Item -LiteralPath $passwordPath }
    foreach ($name in $previous.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
    }
}
exit $testExitCode
