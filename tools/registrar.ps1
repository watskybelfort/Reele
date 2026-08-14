# ============================================================
#  Registra Reele en Windows para que se pueda elegir como
#  reproductor predeterminado.
#
#  LO QUE ESTE SCRIPT NO PUEDE HACER, Y NADIE PUEDE:
#  poner Reele como predeterminado por ti. Desde Windows 10, la clave
#  UserChoice va firmada con un hash que solo sabe calcular el propio
#  sistema; cualquier programa que la escriba a mano se la encuentra
#  revertida al siguiente arranque. Ese ultimo clic es tuyo a proposito,
#  para que ningun instalador te robe los tipos de archivo por la cara.
#
#  LO QUE SI HACE: dejar a Reele declarado como aplicacion capaz de
#  abrir video, de forma que aparezca en Configuracion > Aplicaciones >
#  Aplicaciones predeterminadas y en el "Abrir con" del Explorador. Sin
#  esto, ni siquiera sale en la lista.
#
#  Todo va en HKCU: es tu usuario, no la maquina, y no hace falta
#  administrador. Se deshace entero con -Quitar.
#
#  USO:
#    powershell -NoProfile -ExecutionPolicy Bypass -File registrar.ps1
#    powershell -NoProfile -ExecutionPolicy Bypass -File registrar.ps1 -Exe "C:\ruta\Reele.exe"
#    powershell -NoProfile -ExecutionPolicy Bypass -File registrar.ps1 -Quitar
# ============================================================

param(
    [string]$Exe,
    [switch]$Quitar,
    [switch]$SinAbrirAjustes
)

$ErrorActionPreference = 'Stop'

$APP = 'Reele'
$CAPACIDADES = 'HKCU:\Software\Reele\Capabilities'
$REGISTRADAS = 'HKCU:\Software\RegisteredApplications'
$CLASES = 'HKCU:\Software\Classes'

# Extension -> descripcion. El ProgID se deriva: Reele.mp4, Reele.mkv...
$TIPOS = [ordered]@{
    '.mp4'  = 'Video MP4'
    '.m4v'  = 'Video M4V'
    '.mov'  = 'Video QuickTime'
    '.mkv'  = 'Video Matroska'
    '.webm' = 'Video WebM'
    '.ogv'  = 'Video Ogg Theora'
}

# '.mp4' -> 'Reele.mp4'. La extension ya trae el punto que separa.
function ProgId($ext) { "$APP$ext" }

# ------------------------------------------------------------ quitar
if ($Quitar) {
    foreach ($ext in $TIPOS.Keys) {
        $p = Join-Path $CLASES (ProgId $ext)
        if (Test-Path $p) { Remove-Item $p -Recurse -Force }
        # El OpenWithProgids es una lista compartida: se quita solo lo nuestro.
        $owp = Join-Path $CLASES "$ext\OpenWithProgids"
        if (Test-Path $owp) {
            Remove-ItemProperty -Path $owp -Name (ProgId $ext) -ErrorAction SilentlyContinue
        }
    }
    if (Test-Path 'HKCU:\Software\Reele') { Remove-Item 'HKCU:\Software\Reele' -Recurse -Force }
    if (Test-Path $REGISTRADAS) {
        Remove-ItemProperty -Path $REGISTRADAS -Name $APP -ErrorAction SilentlyContinue
    }
    Write-Output 'Reele ya no esta registrado. Windows dejara de ofrecerlo.'
    exit 0
}

# ------------------------------------------------------------ encontrar el exe
if (-not $Exe) {
    $candidatos = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Reele\Reele.exe'),
        (Join-Path $env:ProgramFiles 'Reele\Reele.exe'),
        (Join-Path $PSScriptRoot '..\dist\win-unpacked\Reele.exe')
    )
    $Exe = $candidatos | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Exe -or -not (Test-Path $Exe)) {
    Write-Error "No encuentro Reele.exe. Instalalo primero, o pasa la ruta con -Exe."
    exit 1
}
$Exe = (Resolve-Path $Exe).Path
Write-Output "Reele: $Exe"

# ------------------------------------------------------------ ProgIDs
# Un ProgID por extension. Podria haber uno solo para todo el video, pero
# entonces Windows no deja elegir "Reele para mp3 y otra cosa para flac".
foreach ($ext in $TIPOS.Keys) {
    $progId = ProgId $ext
    $base = Join-Path $CLASES $progId

    New-Item -Path $base -Force | Out-Null
    Set-ItemProperty -Path $base -Name '(default)' -Value $TIPOS[$ext]
    # FriendlyTypeName es lo que se lee en la columna "Tipo" del Explorador.
    Set-ItemProperty -Path $base -Name 'FriendlyTypeName' -Value $TIPOS[$ext]

    New-Item -Path (Join-Path $base 'DefaultIcon') -Force | Out-Null
    Set-ItemProperty -Path (Join-Path $base 'DefaultIcon') -Name '(default)' -Value "`"$Exe`",0"

    $cmd = Join-Path $base 'shell\open\command'
    New-Item -Path $cmd -Force | Out-Null
    # "%1" entre comillas: sin ellas, cualquier ruta con espacios llega
    # partida en trozos y la app abre "C:\Mi" y "musica\tema.mp3".
    Set-ItemProperty -Path $cmd -Name '(default)' -Value "`"$Exe`" `"%1`""

    # La extension declara que Reele sabe abrirla. Esto es lo que la mete en
    # el "Abrir con", sin tocar quien es el predeterminado ahora.
    #
    # OJO con el -Force: sobre una clave que YA existe, New-Item la vuelve a
    # crear vacia. Esta lista es de todos, no nuestra, asi que crearla "por si
    # acaso" borraba de un plumazo a los demas reproductores del menu "Abrir
    # con". Lo cazo la prueba, con un vecino de mentira que desaparecio.
    $owp = Join-Path $CLASES "$ext\OpenWithProgids"
    if (-not (Test-Path $owp)) { New-Item -Path $owp -Force | Out-Null }
    New-ItemProperty -Path $owp -Name $progId -Value ([byte[]]@()) -PropertyType None -Force | Out-Null
}

# ------------------------------------------------------------ Capabilities
# Este bloque es el que hace que Reele salga en Configuracion >
# Aplicaciones predeterminadas como una entrada propia. Sin el, la app
# aparece suelta en el "Abrir con" y no hay forma comoda de asignarle todo.
New-Item -Path $CAPACIDADES -Force | Out-Null
Set-ItemProperty -Path $CAPACIDADES -Name 'ApplicationName' -Value 'Reele'
Set-ItemProperty -Path $CAPACIDADES -Name 'ApplicationDescription' `
    -Value 'Reproductor de video con acrilico real de Windows'
Set-ItemProperty -Path $CAPACIDADES -Name 'ApplicationIcon' -Value "`"$Exe`",0"

$asociaciones = Join-Path $CAPACIDADES 'FileAssociations'
New-Item -Path $asociaciones -Force | Out-Null
foreach ($ext in $TIPOS.Keys) {
    Set-ItemProperty -Path $asociaciones -Name $ext -Value (ProgId $ext)
}

# Misma trampa que con OpenWithProgids: esta clave la comparten todas las
# aplicaciones del sistema y recrearla las borraria a todas.
if (-not (Test-Path $REGISTRADAS)) { New-Item -Path $REGISTRADAS -Force | Out-Null }
Set-ItemProperty -Path $REGISTRADAS -Name $APP -Value 'Software\Reele\Capabilities'

# Avisar a la shell de que las asociaciones cambiaron, o el Explorador sigue
# enseñando el icono viejo hasta reiniciar.
Add-Type -Language CSharp -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Shell {
    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(int e, uint f, IntPtr a, IntPtr b);
}
"@
[Shell]::SHChangeNotify(0x08000000, 0x0000, [IntPtr]::Zero, [IntPtr]::Zero)  # SHCNE_ASSOCCHANGED

Write-Output ''
Write-Output "Listo: $($TIPOS.Count) tipos de archivo declarados."
Write-Output ''
Write-Output 'AHORA TE TOCA A TI (Windows no deja hacerlo por ti):'
Write-Output '  Configuracion > Aplicaciones > Aplicaciones predeterminadas > Reele'
Write-Output '  y pulsa "Establecer como predeterminado".'
Write-Output ''
Write-Output 'O, mas rapido para un solo tipo: clic derecho en un .mkv >'
Write-Output 'Abrir con > Elegir otra aplicacion > Reele > Establecer siempre.'

if (-not $SinAbrirAjustes) {
    Start-Process 'ms-settings:defaultapps'
}
