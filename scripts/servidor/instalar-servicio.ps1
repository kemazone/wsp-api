<#
  Registra un ambiente como servicio de Windows (una sola vez por ambiente), para que arranque solo con el
  servidor, se reinicie si se cae y el despliegue automático lo pueda detener e iniciar. Usa NSSM (https://nssm.cc).
  Ejecutar en una consola de PowerShell como administrador, con la consola de "npm start" de ese ambiente ya cerrada:

    .\scripts\servidor\instalar-servicio.ps1 -Carpeta D:\DEPLOY\wsp-api-test
    .\scripts\servidor\instalar-servicio.ps1 -Carpeta D:\DEPLOY\wsp-api

  El servicio se llama igual que la carpeta (wsp-api-test, wsp-api). Corre como LocalSystem salvo -Cuenta/-Clave.
  Para quitarlo: nssm remove <nombre> confirm
#>
param(
  [Parameter(Mandatory = $true)][string]$Carpeta,
  [string]$Nombre,
  [string]$Nssm = 'nssm.exe',
  [string]$Cuenta,
  [string]$Clave
)
$ErrorActionPreference = 'Stop'
$Carpeta = (Resolve-Path $Carpeta).Path.TrimEnd('\')
$leaf = Split-Path $Carpeta -Leaf
if (-not $Nombre) { $Nombre = $leaf }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Ejecutar como administrador.' }
if (-not (Get-Command $Nssm -ErrorAction SilentlyContinue)) { throw "No se encontró NSSM ('$Nssm'). Descargarlo de https://nssm.cc, copiar nssm.exe (win64) a C:\nssm y agregar esa carpeta al PATH, o pasar -Nssm C:\nssm\nssm.exe" }
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'No se encontró node.exe en el PATH.' }
if (-not (Test-Path (Join-Path $Carpeta 'src\server.js'))) { throw "No está la aplicación en $Carpeta (falta src\server.js)" }
if (-not (Test-Path (Join-Path $Carpeta '.env'))) { throw "Falta $Carpeta\.env" }
if (Get-Service $Nombre -ErrorAction SilentlyContinue) { Write-Host "El servicio $Nombre ya existe."; exit 0 }

$logs = Join-Path $Carpeta 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null

function N { & $Nssm @args; if ($LASTEXITCODE -ne 0) { throw "nssm $($args -join ' ') falló" } }
N install $Nombre $node 'src\server.js'
N set $Nombre AppDirectory $Carpeta
N set $Nombre DisplayName "WhatsApp API - $leaf"
N set $Nombre Description "API REST de WhatsApp ($Carpeta). Se actualiza desde GitHub Actions."
N set $Nombre Start SERVICE_AUTO_START
N set $Nombre AppStdout (Join-Path $logs 'servicio.log')
N set $Nombre AppStderr (Join-Path $logs 'servicio.log')
N set $Nombre AppRotateFiles 1
N set $Nombre AppRotateOnline 1
N set $Nombre AppRotateBytes 10485760
N set $Nombre AppExit Default Restart
N set $Nombre AppRestartDelay 5000
N set $Nombre AppStopMethodConsole 15000
if ($Cuenta) { N set $Nombre ObjectName $Cuenta $Clave }

Start-Service $Nombre
Write-Host "Servicio $Nombre creado e iniciado (node src\server.js en $Carpeta)."
