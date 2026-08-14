'use strict';

const path = require('node:path');
const fsp = require('node:fs/promises');
const { ipcMain, dialog, shell, app } = require('electron');

const taskbar = require('./taskbar');
const bandeja = require('./bandeja');
const notificaciones = require('./notificaciones');
const despierto = require('./despierto');

const {
  applyBackdrop,
  setMiniPlayer,
  setPantallaCompleta,
  togglePantallaCompleta,
} = require('./window');
const protocols = require('./protocols');
const miniaturas = require('./miniaturas');
const subtitulos = require('./subtitulos');
const { VIDEO_EXTENSIONS, SUBTITLE_EXTENSIONS, VELOCIDADES } = require('./defaults');

/**
 * Registra los handlers del proceso principal.
 * `ctx` lleva { getWindow, settings, library }.
 */
function registerIpc(ctx) {
  const { getWindow, settings, library, progreso, collections } = ctx;

  const withWindow = (fn) => (...args) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return null;
    return fn(win, ...args);
  };

  const emitir = (canal, datos) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(canal, datos);
  };

  const bibliotecaCambio = () => emitir('library:changed', { total: library.size() });

  // --- Ventana ------------------------------------------------------------
  ipcMain.handle('window:minimize', withWindow((win) => {
    win.minimize();
    return true;
  }));

  ipcMain.handle('window:toggle-maximize', withWindow((win) => {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  }));

  ipcMain.handle('window:close', withWindow((win) => {
    win.close();
    return true;
  }));

  ipcMain.handle('window:set-mini', withWindow((win, _e, enabled) => {
    const value = !!enabled;
    settings.set('miniPlayer', value);
    return setMiniPlayer(win, value);
  }));

  ipcMain.handle('window:set-fullscreen', withWindow((win, _e, activa) =>
    setPantallaCompleta(win, activa)));

  ipcMain.handle('window:toggle-fullscreen', withWindow((win) => togglePantallaCompleta(win)));

  ipcMain.handle('window:get-state', withWindow((win) => ({
    maximized: win.isMaximized(),
    focused: win.isFocused(),
    mini: settings.get('miniPlayer', false),
    pantalla: win.isFullScreen(),
  })));

  // --- Barra de tareas, bandeja y pantalla despierta ------------------------
  /*
   * Por `on` y no por `handle`: el renderer avisa de como va la reproduccion
   * varias veces por minuto y no espera respuesta. Un invoke por cada aviso
   * seria una promesa ida y vuelta para nada.
   */
  const mandarOrden = (orden) => emitir('player:command', { orden });

  bandeja.sincronizar(settings.get('minimizeToTray', false), {
    getWindow,
    mandar: mandarOrden,
    salir: () => app.quit(),
  });

  let ultimaVentana = null;
  ipcMain.on('player:state', (_e, estado) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    // Una ventana nueva nace sin botones ni distintivo. El cache de "lo ultimo
    // aplicado" es del modulo, no de la ventana: sin este reinicio la firma
    // seguiria coincidiendo y la barra se quedaria vacia para siempre.
    if (win !== ultimaVentana) {
      ultimaVentana = win;
      taskbar.reiniciar();
    }
    taskbar.aplicarEstado(win, estado, mandarOrden);

    // El bloqueo de apagado de pantalla se ata a que haya algo en marcha, no
    // a que la aplicacion este abierta: en pausa, el equipo tiene que poder
    // descansar como con cualquier otro programa.
    despierto.activar(!!estado?.viendo && settings.get('keepAwake', true));

    // El aviso y la bandeja salen del mismo parte porque el cambio de video ya
    // viene ahi: un canal por cada uno mandaria tres mensajes por pelicula.
    const track = estado?.id ? library.get(estado.id) : null;
    if (track) {
      notificaciones.avisarDeVideo(win, track, {
        activo: settings.get('showNotifications', true),
        viendo: !!estado.viendo,
      });
    }
    bandeja.actualizar({ track, viendo: !!estado?.viendo, hayVideo: !!estado?.hayVideo });
  });

  // --- Ajustes ------------------------------------------------------------
  ipcMain.handle('settings:all', () => settings.all());

  ipcMain.handle('settings:set', (_e, patch) => {
    if (!patch || typeof patch !== 'object') return settings.all();
    settings.merge(patch);
    // La bandeja se enciende y se apaga en el acto: si esperase al siguiente
    // arranque, el ajuste pareceria no hacer nada.
    if (patch.minimizeToTray !== undefined) {
      bandeja.sincronizar(!!patch.minimizeToTray, {
        getWindow,
        mandar: mandarOrden,
        salir: () => app.quit(),
      });
    }
    // Apagar "mantener la pantalla encendida" tiene que soltar el bloqueo ya,
    // no al siguiente cambio de estado del reproductor.
    if (patch.keepAwake === false) despierto.activar(false);
    emitir('settings:changed', patch);
    return settings.all();
  });

  // --- Vidrio -------------------------------------------------------------
  ipcMain.handle('backdrop:apply', (_e, mode) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return null;
    if (mode) settings.set('backdrop', mode);
    return applyBackdrop(win, settings);
  });

  // --- Biblioteca ---------------------------------------------------------
  ipcMain.handle('library:all', () => library.all().map(paraCliente));

  ipcMain.handle('library:folders', () => settings.get('folders', []));

  ipcMain.handle('library:scan', async () => {
    const folders = settings.get('folders', []);
    if (!folders.length) return { ok: false, reason: 'sin-carpetas' };
    const res = await library.scan(folders, (p) => emitir('library:progress', p));
    bibliotecaCambio();
    return res;
  });

  ipcMain.handle('library:cancel-scan', () => {
    library.cancel();
    return true;
  });

  ipcMain.handle('library:add-folder', withWindow(async (win) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Anadir carpetas de video',
      properties: ['openDirectory', 'multiSelections'],
    });
    if (canceled || !filePaths.length) return null;

    const actuales = settings.get('folders', []);
    const fusion = [...new Set([...actuales, ...filePaths])];
    settings.set('folders', fusion);
    for (const f of fusion) protocols.allowRoot(f);

    const res = await library.scan(fusion, (p) => emitir('library:progress', p));
    bibliotecaCambio();
    return { folders: fusion, ...res };
  }));

  ipcMain.handle('library:remove-folder', async (_e, folder) => {
    const restantes = settings.get('folders', []).filter((f) => f !== folder);
    settings.set('folders', restantes);

    // Se rehacen las raices autorizadas desde cero: quitar una carpeta tiene
    // que revocar el acceso, no solo sacarla de la lista.
    protocols.clearRoots();
    for (const f of restantes) protocols.allowRoot(f);

    const res = await library.scan(restantes, (p) => emitir('library:progress', p));
    bibliotecaCambio();
    return { folders: restantes, ...res };
  });

  ipcMain.handle('library:open-files', withWindow(async (win) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Abrir archivos de video',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Video', extensions: VIDEO_EXTENSIONS.map((e) => e.slice(1)) },
        { name: 'Todos', extensions: ['*'] },
      ],
    });
    if (canceled || !filePaths.length) return [];
    const tracks = await library.addFiles(filePaths);
    bibliotecaCambio();
    return tracks.map(paraCliente);
  }));

  ipcMain.handle('library:add-paths', async (_e, rutas) => {
    if (!Array.isArray(rutas) || !rutas.length) return [];
    const expandidas = await expandir(rutas);
    const tracks = await library.addFiles(expandidas);
    bibliotecaCambio();
    return tracks.map(paraCliente);
  });

  ipcMain.handle('library:reveal', (_e, ruta) => {
    if (typeof ruta === 'string' && ruta) shell.showItemInFolder(ruta);
    return true;
  });

  // --- Sondeo ---------------------------------------------------------------

  /** Los que aun no han pasado por el decodificador del renderer. */
  ipcMain.handle('library:pending', () => library.pendientes().map(paraCliente));

  /**
   * El renderer devuelve lo que averiguo abriendo el archivo.
   *
   * Se contesta con el video ya actualizado en vez de con un simple `ok`: la
   * lista necesita la URL nueva de la miniatura para pintar esa fila, y
   * pedirla en otra vuelta seria un IPC mas por cada video de la biblioteca.
   */
  ipcMain.handle('library:probed', async (_e, datos) => {
    if (!datos?.id) return null;
    const thumb = datos.thumb ? await miniaturas.guardar(datos.thumb) : null;
    const track = library.enriquecer(datos.id, { ...datos, thumb });
    if (!track) return null;
    const paraFuera = paraCliente(track);
    emitir('library:enriched', paraFuera);
    return paraFuera;
  });

  /**
   * Fin de la tanda: es el momento de tirar los fotogramas huerfanos.
   *
   * Se hace aqui y no al escanear porque hasta que el sondeo termina hay
   * videos con miniatura recien creada que la biblioteca todavia no tiene
   * apuntada, y una limpieza en ese momento se las llevaria por delante.
   */
  ipcMain.handle('library:probe-done', async () => {
    const vivos = library.all().map((t) => t.thumb).filter(Boolean);
    return miniaturas.limpiar(vivos);
  });

  // --- Favoritos y listas ---------------------------------------------------

  ipcMain.handle('coll:favorites', () => collections.favoriteIds());

  ipcMain.handle('coll:toggle-favorite', (_e, id) => {
    const valor = collections.toggleFavorite(id);
    emitir('coll:changed', { favorites: collections.favoriteIds() });
    return valor;
  });

  /** Envolver cada cambio con el aviso evita que una lista se quede sin pintar. */
  const conListas = (fn) => (...args) => {
    const salida = fn(...args);
    emitir('coll:playlists', { playlists: collections.playlists });
    return salida;
  };

  ipcMain.handle('pl:all', () => collections.playlists);

  ipcMain.handle('pl:create', conListas((_e, name, trackIds) =>
    collections.createPlaylist(name, trackIds)));

  ipcMain.handle('pl:rename', conListas((_e, id, name) =>
    collections.renamePlaylist(id, name)));

  ipcMain.handle('pl:remove', conListas((_e, id) => collections.removePlaylist(id)));

  ipcMain.handle('pl:add', conListas((_e, id, trackIds) =>
    collections.addToPlaylist(id, trackIds)));

  ipcMain.handle('pl:remove-at', conListas((_e, id, indice) =>
    collections.removeFromPlaylist(id, indice)));

  ipcMain.handle('pl:move', conListas((_e, id, desde, hasta) =>
    collections.movePlaylistTrack(id, desde, hasta)));

  // --- Por donde iba --------------------------------------------------------

  ipcMain.handle('prog:for', (_e, id) => progreso.de(id));

  ipcMain.handle('prog:fractions', () => progreso.fracciones());

  ipcMain.handle('prog:continue', (_e, limite) => progreso.seguirViendo(limite));

  ipcMain.handle('prog:forget', (_e, id) => progreso.olvidar(id));

  ipcMain.handle('prog:seen', (_e, id, duracion) => progreso.marcarVisto(id, duracion));

  /*
   * Por `on` y no por `handle`: el renderer avisa cada pocos segundos
   * mientras hay algo en marcha y no espera respuesta. Un invoke por cada
   * aviso seria una promesa ida y vuelta para nada.
   */
  ipcMain.on('prog:save', (_e, id, t, dur) => {
    progreso.guardar(id, t, dur);
  });

  // --- Subtitulos -----------------------------------------------------------

  /**
   * Lo encontrado para cada video, por id.
   *
   * No es solo cache: es lo que convierte `subs:read` en algo seguro. El
   * renderer manda un id de pista, nunca una ruta, asi que no puede pedir
   * que se le lea un archivo cualquiera del disco — solo uno de los que la
   * busqueda ya habia encontrado junto a ese video.
   */
  const subsPorVideo = new Map();

  ipcMain.handle('subs:for', async (_e, videoId) => {
    const track = videoId ? library.get(videoId) : null;
    if (!track) return [];
    const lista = await subtitulos.buscar(track.path);
    subsPorVideo.set(videoId, lista);
    // La ruta no sale de aqui: al renderer solo le hace falta con que
    // llamarla en el menu y con que pedirla despues.
    return lista.map(({ ruta, ...resto }) => resto);
  });

  ipcMain.handle('subs:read', async (_e, videoId, subId) => {
    const pista = subsPorVideo.get(videoId)?.find((s) => s.id === subId);
    if (!pista) return { ok: false, error: 'esa pista ya no esta', cues: [] };
    return subtitulos.leer(pista.ruta);
  });

  // --- Varios -------------------------------------------------------------
  /**
   * Abrir un enlace fuera.
   *
   * Solo http(s), y comprobado aqui. La pagina no puede mandar `file://` ni
   * un esquema raro: `shell.openExternal` se lo pasaria al sistema tal cual,
   * y eso es ejecutar lo que diga la cadena.
   */
  ipcMain.handle('app:open-external', (_e, url) => {
    let destino;
    try {
      destino = new URL(String(url));
    } catch {
      return false;
    }
    if (destino.protocol !== 'https:' && destino.protocol !== 'http:') return false;
    shell.openExternal(destino.toString());
    return true;
  });

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    userData: app.getPath('userData'),
  }));

  /**
   * Las listas de extensiones y velocidades viven en defaults.js y viajan por
   * aqui. El preload va en sandbox y no puede requerir archivos del proyecto,
   * asi que la alternativa seria copiarlas en el renderer y verlas separarse.
   */
  ipcMain.handle('app:constants', () => ({
    videoExtensions: VIDEO_EXTENSIONS,
    subtitleExtensions: SUBTITLE_EXTENSIONS,
    velocidades: VELOCIDADES,
  }));
}

/**
 * Lo que ve el renderer. Las rutas del disco no viajan como `file://`: la
 * pagina no puede leerlas y ademas serian un agujero. Van como URL del
 * esquema propio, que ya valida contra las raices autorizadas.
 */
function paraCliente(track) {
  return {
    ...track,
    url: protocols.encodePath(track.path),
    thumbUrl: track.thumb ? protocols.thumbUrl(track.thumb) : null,
  };
}

/** Si sueltan una carpeta, hay que entrar a buscar el video de dentro. */
async function expandir(rutas) {
  const salida = [];
  const exts = new Set(VIDEO_EXTENSIONS);

  for (const ruta of rutas) {
    let stat;
    try {
      stat = await fsp.stat(ruta);
    } catch {
      continue;
    }
    if (stat.isFile()) {
      if (exts.has(path.extname(ruta).toLowerCase())) salida.push(ruta);
      continue;
    }
    if (stat.isDirectory()) {
      protocols.allowRoot(ruta);
      const pila = [ruta];
      while (pila.length) {
        const dir = pila.pop();
        let entradas;
        try {
          entradas = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const e of entradas) {
          const completo = path.join(dir, e.name);
          if (e.isDirectory()) pila.push(completo);
          else if (exts.has(path.extname(e.name).toLowerCase())) salida.push(completo);
        }
      }
    }
  }
  return salida;
}

module.exports = { registerIpc, paraCliente };
