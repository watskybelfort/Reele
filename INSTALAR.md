# Instalar Reele y ponerlo por defecto

## 1. Construir el instalador

```powershell
npm ci
npm run icono   # dibuja build/icon.ico a partir del codigo
npm run dist    # deja el instalador en dist/
```

Sale `dist/Reele-0.1.0-x64.exe`. Es un instalador NSIS **por usuario**: no pide
administrador, se instala en `%LOCALAPPDATA%\Programs\Reele` y se desinstala
desde Configuración como cualquier otra aplicación.

Si solo quieres probarlo sin instalar nada, `npm run pack` deja la aplicación
suelta en `dist/win-unpacked/Reele.exe`.

## 2. Instalar

Doble clic en el instalador. Deja elegir carpeta y crea accesos directos en el
escritorio y en el menú de inicio.

Ya declara los seis tipos de archivo que Reele sabe abrir (mp4, m4v, mov, mkv,
webm, ogv), así que a partir de aquí aparece en el menú **Abrir con** del
Explorador.

Ninguno de esos seis se pisa con los de Sounde: las dos aplicaciones pueden
convivir instaladas y cada una se queda con lo suyo.

## 3. Registrarlo en "Aplicaciones predeterminadas"

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\registrar.ps1
```

Esto declara Reele como aplicación capaz de abrir vídeo y lo mete en la lista
de Configuración. Escribe solo en `HKCU` (tu usuario, no la máquina) y se
deshace entero con:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\registrar.ps1 -Quitar
```

Si estás probando la versión sin instalar, pásale la ruta:

```powershell
... -File tools\registrar.ps1 -Exe "dist\win-unpacked\Reele.exe"
```

## 4. El último clic es tuyo

**Ningún programa puede ponerse como predeterminado por su cuenta en Windows
10 u 11, y Reele tampoco.** La clave `UserChoice` que decide quién abre cada
extensión va firmada con un hash que solo sabe calcular el propio sistema:
cualquier aplicación que la escriba a mano se la encuentra revertida al
siguiente arranque. Es deliberado, y está bien que lo sea — es lo que impide
que un instalador te robe los tipos de archivo sin preguntar.

Así que el último paso lo das tú, por cualquiera de estas dos vías:

**Todo de una vez.** Configuración → Aplicaciones → Aplicaciones
predeterminadas → busca **Reele** → *Establecer como predeterminado*.
El script abre esa pantalla al terminar.

**Un tipo suelto.** Clic derecho en un `.mkv` → Abrir con → Elegir otra
aplicación → **Reele** → marca *Usar siempre esta aplicación*.

## 5. Comprobar que funcionó

Doble clic en cualquier vídeo del disco. Debe abrirse Reele y empezar a
reproducirlo. Si Reele ya estaba abierto, el vídeo entra en la instancia que ya
existe en vez de levantar un segundo reproductor.

Si el archivo tiene un `.srt` al lado, los subtítulos se ponen solos cuando el
idioma coincida con el preferido de Ajustes.

## Si se ve pero no suena

No es un fallo de la instalación: ese archivo lleva el audio en AC3 o DTS, y
Chromium no los decodifica. Ver la tabla de formatos en el
[README](README.md#lo-que-no-puede-reproducir).

## Desinstalar

Configuración → Aplicaciones → Reele → Desinstalar.

El desinstalador **no** borra tu biblioteca, tus favoritos, tus listas ni por
dónde ibas en cada película: eso vive en `%APPDATA%\Reele` y es lo único que no
se puede recuperar volviendo a escanear el disco. Si de verdad quieres borrarlo
todo, esa carpeta se elimina a mano.
