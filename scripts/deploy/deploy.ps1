<#
  Despliega la aplicación en una carpeta de ambiente (D:\DEPLOY\<carpeta>). Ver docs/CI-CD.md.
  Lo ejecuta GitHub Actions en el servidor; también se puede correr a mano desde una consola de administrador:
    .\scripts\deploy\deploy.ps1 -Origen C:\fuentes\wsp-api -Destino D:\DEPLOY\wsp-api-test

  Pasos: respaldo de la base -> copia de la versión actual -> detener servicio -> copiar código ->
         dependencias -> migraciones -> iniciar servicio -> verificar que responda.
  Si algo falla después de detener el servicio, vuelve solo a la versión anterior (las migraciones
  son aditivas, así que el código anterior funciona con la base ya migrada).

  Nunca toca: .env, web.config, logs, node_modules (salvo npm) ni archivos propios de la carpeta.
  (Adaptado del deploy.ps1 de gestion-app: el servicio de Windows se llama igual que la carpeta, por ejemplo wsp-api-test.)
#>
param(
  [Parameter(Mandatory = $true)][string]$Origen,
  [Parameter(Mandatory = $true)][string]$Destino,
  [string]$Servicio,
  [string]$DirRespaldos = 'D:\RESPALDOS',
  [string]$DirVersiones = 'D:\DEPLOY_VERSIONES',
  [switch]$SinRespaldo,
  [int]$EsperaSegundos = 180,
  [int]$ConservarVersiones = 5,
  [int]$ConservarRespaldos = 10
)
$ErrorActionPreference = 'Stop'
$Destino = $Destino.TrimEnd('\')
$carpeta = Split-Path $Destino -Leaf
if (-not $Servicio) { $Servicio = $carpeta }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

function Paso([string]$t) { Write-Host ''; Write-Host "==> $t" }
function Aviso([string]$t) { Write-Host "::warning::$t" }

# Ejecuta un programa externo y falla si termina con error (sin que los avisos por stderr de npm/git corten el script)
# $null como entrada: ningún programa queda esperando teclado
function Nativo([string]$exe, [string[]]$argumentos, [string]$dir) {
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  Push-Location $dir
  try { $null | & $exe @argumentos; $code = $LASTEXITCODE } finally { Pop-Location; $ErrorActionPreference = $eap }
  if ($code -ne 0) { throw "'$exe $($argumentos -join ' ')' terminó con código $code" }
}

function Copiar([string]$de, [string]$a, [string[]]$extra) {
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & robocopy $de $a @extra /NFL /NDL /NJH /NJS /NP /R:2 /W:2 | Out-Null; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $eap }
  if ($code -ge 8) { throw "robocopy '$de' -> '$a' falló (código $code)" }
}

# Solo se reemplaza la carpeta de código (src) y los archivos raíz del proyecto
function CopiarCodigo([string]$de, [string]$a) {
  foreach ($d in 'src') {
    if (Test-Path (Join-Path $de $d)) { Copiar (Join-Path $de $d) (Join-Path $a $d) @('/MIR') }
  }
  Copiar $de $a @('package.json', 'package-lock.json', 'README.md', '.env.example')
}

function Dependencias([string]$dir, [bool]$usarCi) {
  if ($usarCi) { Nativo 'npm.cmd' @('ci', '--omit=dev', '--no-audit', '--no-fund') $dir }
  else { Nativo 'npm.cmd' @('install', '--omit=dev', '--no-audit', '--no-fund') $dir }
}

function Version([string]$dir) {
  $f = Join-Path $dir 'package.json'
  if (Test-Path $f) { return [string](Get-Content $f -Raw -Encoding UTF8 | ConvertFrom-Json).version }
  return ''
}

function Puerto([string]$dir) {
  $m = Select-String -Path (Join-Path $dir '.env') -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1
  if ($m) { return [int]$m.Matches[0].Groups[1].Value }
  return 3200
}

function Escuchando([int]$p) { return [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) }

function Responde([int]$p, [int]$segundos) {
  $hasta = (Get-Date).AddSeconds($segundos)
  while ((Get-Date) -lt $hasta) {
    try {
      $r = Invoke-WebRequest "http://localhost:$p/" -UseBasicParsing -TimeoutSec 5
      if ($r.StatusCode -eq 200) { return $true }
    } catch { }
    if ((Get-Service $Servicio).Status -eq 'Stopped') { Start-Sleep -Seconds 2 } # NSSM lo reinicia si se cayó
    Start-Sleep -Seconds 3
  }
  return $false
}

# Pide detener el servicio sin quedarse esperando (Stop-Service espera para siempre); si en 15 s no paró, cierra el node y, si hace falta, NSSM
function Detener {
  $s = Get-Service $Servicio
  if ($s.Status -eq 'Stopped') { return }
  if ($s.Status -ne 'StopPending') {
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $null | & sc.exe stop $Servicio | Out-Null } finally { $ErrorActionPreference = $eap }
  }
  try { $s.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(15)); return } catch { }
  # NSSM no logra cerrar el node por su cuenta: se cierra el node y NSSM termina de detenerse solo
  $svcPid = [int](Get-CimInstance Win32_Service -Filter "Name='$Servicio'").ProcessId
  if ($svcPid -gt 0) { Get-CimInstance Win32_Process -Filter "ParentProcessId=$svcPid" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }
  try { $s.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(20)); Write-Host '    (se cerró el proceso node para que el servicio se detenga)'; return } catch { }
  Aviso "El servicio $Servicio no se detuvo: se cierra NSSM a la fuerza."
  if ($svcPid -gt 0) { Stop-Process -Id $svcPid -Force -ErrorAction SilentlyContinue }
  $con = Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($con) { Stop-Process -Id $con.OwningProcess -Force -ErrorAction SilentlyContinue }
  try { (Get-Service $Servicio).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30)) } catch { throw "No se pudo detener el servicio $Servicio ni cerrando sus procesos." }
}

function UltimoLog {
  $dirLogs = Join-Path $Destino 'logs'
  if (-not (Test-Path $dirLogs)) { return }
  $f = Get-ChildItem $dirLogs -Filter '*.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($f) { Write-Host "--- Últimas líneas de $($f.Name) ---"; Get-Content $f.FullName -Tail 40 -Encoding UTF8 | ForEach-Object { Write-Host $_ } }
}

function Resumen([string]$t) { if ($env:GITHUB_STEP_SUMMARY) { $t | Out-File -Append -Encoding utf8 $env:GITHUB_STEP_SUMMARY } }

# ---------------------------------------------------------------- verificaciones
$nueva = Version $Origen
$actual = Version $Destino
$txtActual = 'ninguna'
if ($actual) { $txtActual = 'v' + $actual }
Paso "Desplegando v$nueva en $Destino (servicio $Servicio). Versión instalada: $txtActual"
if (-not $nueva) { throw "No se encontró package.json en $Origen" }
if (-not (Test-Path $Destino)) { throw "No existe la carpeta $Destino" }
if (-not (Test-Path (Join-Path $Destino '.env'))) { throw "Falta $Destino\.env (el archivo de configuración del ambiente no viaja en el repo: crearlo a partir de .env.example)" }
if (-not (Get-Service $Servicio -ErrorAction SilentlyContinue)) { throw "No existe el servicio de Windows '$Servicio'. Crearlo una vez con scripts\servidor\instalar-servicio.ps1 -Carpeta $Destino" }
try { if ($actual -and ([version]$nueva -lt [version]$actual)) { Aviso "Se instala una versión ANTERIOR (v$nueva) a la que hay (v$actual). Las migraciones de la base no se deshacen." } } catch { }
$puerto = Puerto $Destino
$usarCi = Test-Path (Join-Path $Origen 'package-lock.json')
if (-not $usarCi) { Aviso 'El repo no tiene package-lock.json: se usa npm install y las versiones de las dependencias pueden variar entre ambientes. Conviene versionarlo.' }

# ---------------------------------------------------------------- respaldo de la base (con el código y el .env instalados)
$bak = $null
if ($SinRespaldo) { Aviso 'Se despliega SIN copia de seguridad de la base.' }
elseif (-not (Test-Path (Join-Path $Destino 'node_modules'))) { Aviso 'No hay una instalación previa completa (sin node_modules): se omite la copia de seguridad.' }
else {
  Paso "Copia de seguridad de la base"
  New-Item -ItemType Directory -Force $DirRespaldos | Out-Null
  $bak = Join-Path $DirRespaldos "$carpeta-v$actual-$stamp.bak"
  Nativo 'node' @('src\backup.js', $bak) $Destino
  Get-ChildItem $DirRespaldos -Filter "$carpeta-v*.bak" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -Skip $ConservarRespaldos | Remove-Item -Force
}

# ---------------------------------------------------------------- copia de la versión instalada (para volver atrás)
$copia = $null
if (Test-Path (Join-Path $Destino 'src')) {
  Paso "Guardando la versión instalada (v$actual)"
  $copia = Join-Path $DirVersiones "$carpeta\$stamp-v$actual"
  Copiar $Destino $copia @('/E', '/XD', 'node_modules', 'logs', '/XF', '.env', '*.log')
  Get-ChildItem (Join-Path $DirVersiones $carpeta) -Directory | Sort-Object Name -Descending | Select-Object -Skip $ConservarVersiones | Remove-Item -Recurse -Force
}

# ---------------------------------------------------------------- actualización
Paso "Deteniendo el servicio $Servicio"
Detener
Start-Sleep -Seconds 2
if (Escuchando $puerto) { throw "El servicio está detenido pero otro proceso sigue usando el puerto $puerto (¿una consola con npm start abierta?). Cerrarlo y volver a ejecutar." }

try {
  Paso 'Copiando el código nuevo'
  CopiarCodigo $Origen $Destino
  Paso 'Instalando dependencias'
  Dependencias $Destino $usarCi
  Paso 'Aplicando migraciones de la base'
  Nativo 'node' @('src\migrar.js') $Destino
  Paso "Iniciando el servicio y esperando respuesta en http://localhost:$puerto/"
  Start-Service $Servicio
  if (-not (Responde $puerto $EsperaSegundos)) { throw "La aplicación no respondió en http://localhost:$puerto/ después de $EsperaSegundos s" }
} catch {
  $err = $_
  Write-Host "::error::Falló el despliegue de v$nueva en ${carpeta}: $err"
  UltimoLog
  if ($copia) {
    Paso "Volviendo a la versión anterior (v$actual)"
    try {
      Detener
      CopiarCodigo $copia $Destino
      Dependencias $Destino $false
      Start-Service $Servicio
      if (Responde $puerto $EsperaSegundos) { Write-Host "::warning::Se restauró v$actual en $carpeta y responde normalmente." }
      else { Write-Host "::error::Se restauró v$actual en $carpeta pero tampoco responde: revisar a mano." ; UltimoLog }
    } catch { Write-Host "::error::No se pudo volver a la versión anterior: $_ (copia en $copia)" }
  }
  if ($bak) { Write-Host "Copia de seguridad de la base previa al despliegue: $bak" }
  $txt = "**${carpeta}**: falló el despliegue de v$nueva."
  if ($copia) { $txt += " Se intentó volver a v$actual." }
  Resumen $txt
  exit 1
}

Write-Host ''
Write-Host "OK: $carpeta actualizado a v$nueva"
$txt = "**${carpeta}**: actualizado a **v$nueva** (antes v$actual)"
if ($bak) { $txt += ' - respaldo: ' + $bak }
Resumen $txt
exit 0
