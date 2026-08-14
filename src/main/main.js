'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const { JsonStore } = require('./store');
const { DEFAULT_SETTINGS, VIDEO_EXTENSIONS } = require('./defaults');
const { createMainWindow, setMiniPlayer } = require('./window');
const { registerIpc, paraCliente } = require('./ipc');
const { registerSchemes, registerHandlers } = require('./protocols');
const protocols = require('./protocols');
const { Library } = require('./library');
const { Progreso } = require('./progreso');
const { Collections } = require('./collections');
const taskbar = require('./taskbar');
const bandeja = require('./bandeja');
const despierto = require('./despierto');

const APP_URL = 'reele://app/index.html';

// Una sola instancia: si el usuario abre un segundo archivo desde el
// Explorador, se lo pasamos a la ventana que ya esta abierta en vez de
// levantar un reproductor nuevo que compita por la pantalla.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  main();
}

let mainWindow = null;
let settings = null;
let library = null;
let progreso = null;
let collections = null;
/** Distingue "cerrar la ventana" de "salir del programa" con la bandeja puesta. */
let saliendo = false;
/** Archivos que llegaron de un doble clic antes de que hubiera ventana. */
const pendientes = [];

function main() {
  app.setAppUserModelId(identidadShell());
  app.commandLine.appendSwitch('force_high_performance_gpu');

  /**
   * Sin esto no existe `video.audioTracks` y no hay forma de saber que un
   * MKV trae castellano e ingles, ni mucho menos de cambiar de uno a otro.
   * Chromium lo tiene implementado pero apagado por defecto detras de esta
   * bandera de Blink.
   *
   * Es una peticion, no una garantia: si la version de Chromium de turno no
   * lo expone, `audioTracks` sale undefined y la UI esconde el selector en
   * vez de ensenar un menu vacio.
   */
  app.commandLine.appendSwitch('enable-blink-features', 'AudioVideoTracks');

  // Los privilegios de esquema hay que declararlos antes de que Chromium
  // arranque; despues de app.ready se ignoran en silencio.
  registerSchemes();

  app.on('second-instance', (_e, argv) => {
    const archivos = archivosDeArgv(argv);
    // El doble clic puede caer mientras la ventana todavia se esta creando.
    // Guardarlos es la diferencia entre que la pelicula se abra o se pierda
    // en silencio, que es el peor final posible para un doble clic.
    if (!mainWindow || mainWindow.isDestroyed()) {
      pendientes.push(...archivos);
      return;
    }
    alFrente(mainWindow);
    abrirArchivos(archivos);
  });

  app.whenReady().then(async () => {
    settings = new JsonStore(
      path.join(app.getPath('userData'), 'settings.json'),
      DEFAULT_SETTINGS,
    );

    registerHandlers();

    const libraryStore = new JsonStore(
      path.join(app.getPath('userData'), 'library.json'),
      { version: 1, tracks: [] },
    );
    library = new Library(libraryStore);

    // Sin volver a autorizar las carpetas guardadas, tras reiniciar la app
    // toda la biblioteca da 403 al intentar reproducirse.
    for (const carpeta of settings.get('folders', [])) protocols.allowRoot(carpeta);
    for (const track of library.all()) protocols.allowFile(track.path);

    // Almacen aparte del de la biblioteca: la biblioteca se reconstruye con
    // cada escaneo, pero por donde iba cada video no lo puede recuperar el
    // usuario de ninguna manera.
    const progresoStore = new JsonStore(
      path.join(app.getPath('userData'), 'progreso.json'),
      { version: 1, videos: {} },
    );
    progreso = new Progreso(progresoStore, settings);

    const collectionsStore = new JsonStore(
      path.join(app.getPath('userData'), 'collections.json'),
      { version: 1, favorites: [], playlists: [] },
    );
    collections = new Collections(collectionsStore);

    registerIpc({ getWindow: () => mainWindow, settings, library, progreso, collections });

    mainWindow = createMainWindow(settings);
    mainWindow.loadURL(APP_URL);
    aBandejaAlCerrar(mainWindow);

    if (settings.get('miniPlayer')) {
      mainWindow.once('ready-to-show', () => setMiniPlayer(mainWindow, true));
    }

    if (process.argv.includes('--dev')) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
      espiarConsola(mainWindow);
    }

    mainWindow.webContents.once('did-finish-load', () => {
      abrirArchivos([...archivosDeArgv(process.argv), ...pendientes.splice(0)]);
      escaneoInicial();
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow(settings);
        mainWindow.loadURL(APP_URL);
        aBandejaAlCerrar(mainWindow);
      }
    });
  });

  app.on('window-all-closed', () => {
    cerrar();
    app.quit();
  });

  app.on('before-quit', () => {
    // A partir de aqui la X ya no esconde: se esta saliendo de verdad.
    saliendo = true;
    cerrar();
  });
}

/**
 * Con la bandeja puesta, la X esconde la ventana en vez de cerrarla.
 *
 * En un reproductor de video tiene menos sentido que en uno de musica —nadie
 * ve una pelicula con la ventana cerrada—, pero si lo tiene para quitarla de
 * en medio un rato sin perder la cola ni la posicion. Por eso el ajuste viene
 * apagado y hay que pedirlo.
 */
function aBandejaAlCerrar(win) {
  win.on('close', (evento) => {
    if (saliendo || !settings?.get('minimizeToTray', false)) return;
    evento.preventDefault();
    win.hide();
  });
}

/**
 * La identidad de la app para la shell de Windows.
 *
 * En desarrollo se usa OTRA a proposito. El AppUserModelId es lo que Windows
 * usa para decidir el icono y el nombre del boton de la barra de tareas, y lo
 * resuelve contra el ultimo ejecutable que reclamo esa identidad. `npm start`
 * corre sobre electron.exe: si reclamara la misma que la app instalada, la
 * deja apuntando ahi, y a partir de ese momento la Reele INSTALADA sale en la
 * barra con el atomo gris y el nombre "Electron" por mucho que su ventana, su
 * .exe y sus accesos directos lleven el icono bueno.
 *
 * Y esa atadura no se suelta: no la quitan ni vaciar la cache de iconos, ni
 * reiniciar la shell, ni borrar las caches del resolvedor del menu de inicio.
 * Por eso la identidad lleva sufijo desde el primer dia — es una leccion que
 * Sounde aprendio a base de reinstalaciones.
 *
 * El appId del instalador NO se toca: de el cuelgan las asociaciones de
 * archivo y la entrada de desinstalacion.
 */
function identidadShell() {
  const base = 'com.mxrningstar.reele';
  return app.isPackaged ? `${base}.app` : `${base}.dev`;
}

/**
 * Trae la ventana al frente de verdad.
 *
 * Windows no deja que un programa que esta de fondo se ponga delante por las
 * buenas: ese permiso lo tiene el proceso que el usuario acaba de lanzar (la
 * segunda instancia, que ya se murio), no el nuestro. Por eso focus() a secas
 * puede no hacer nada y el video acaba reproduciendose detras del Explorador,
 * que desde fuera se ve igual que si el doble clic no hubiera funcionado.
 * Pasar un instante por TOPMOST si lo consigue, porque eso no pide el primer
 * plano.
 */
function alFrente(win) {
  if (win.isMinimized()) win.restore();
  // Escondida en la bandeja, restore() no la saca: hay que mostrarla.
  if (!win.isVisible()) win.show();

  // El mini reproductor ya flota a proposito: ahi no hay nada que restaurar.
  const flotaba = win.isAlwaysOnTop();
  if (!flotaba) win.setAlwaysOnTop(true);
  win.focus();
  if (!flotaba) win.setAlwaysOnTop(false);
}

function cerrar() {
  if (settings) settings.save();
  if (library) library.persist();
  if (progreso) progreso.store.save();
  if (collections) collections.store.save();
  // Sin esto Windows deja el distintivo pegado al icono hasta que el hueco de
  // la barra de tareas se recicla, que puede tardar.
  taskbar.limpiar(mainWindow);
  bandeja.destruir();
  // Y el bloqueo de apagado de pantalla sobrevive al proceso si no se suelta.
  despierto.soltar();
}

/**
 * Con --dev, lo que la pagina escribe en consola sale tambien por el terminal.
 *
 * Sin esto, depurar el renderer obliga a tener las herramientas de desarrollo
 * abiertas y a mirarlas a mano, que no sirve de nada cuando lo que se quiere
 * es leer un aviso que salta una vez al arrancar.
 *
 * La firma del evento cambio en Electron: antes eran cuatro argumentos
 * sueltos y ahora es un objeto. Se aceptan las dos para no atarse a una
 * version concreta.
 */
function espiarConsola(win) {
  win.webContents.on('console-message', (evento, nivel, mensaje) => {
    const texto = evento?.message ?? mensaje;
    const linea = evento?.lineNumber ?? '';
    const fuente = evento?.sourceId ? ` (${path.basename(evento.sourceId)}:${linea})` : '';
    if (texto) console.log(`[pagina]${fuente}`, texto);
  });
}

/**
 * Los archivos que llegan de "Abrir con..." vienen sueltos en argv, mezclados
 * con los flags de Chromium. Se filtra por extension conocida y existencia
 * real: cualquier otra cosa es un flag, no un video.
 */
function archivosDeArgv(argv = []) {
  const exts = new Set(VIDEO_EXTENSIONS);
  return argv
    .slice(1)
    .filter((a) => typeof a === 'string' && !a.startsWith('-'))
    .filter((a) => exts.has(path.extname(a).toLowerCase()))
    .filter((a) => {
      try {
        return fs.statSync(a).isFile();
      } catch {
        return false;
      }
    })
    .map((a) => path.resolve(a));
}

/**
 * Escaneo al arrancar.
 *
 * Es incremental y no abre ningun archivo, asi que sobre una biblioteca ya
 * vista cuesta milisegundos. Sin esto, lo que el usuario haya anadido a sus
 * carpetas con la app cerrada no aparece hasta que se acuerde de pulsar
 * "volver a escanear", que no se le va a ocurrir a nadie.
 */
async function escaneoInicial() {
  const folders = settings.get('folders', []);
  if (!folders.length || !library) return;

  const enviar = (canal, datos) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(canal, datos);
  };

  try {
    await library.scan(folders, (p) => enviar('library:progress', p));
  } catch (err) {
    console.error('[main] el escaneo inicial fallo:', err.message);
  }
  for (const track of library.all()) protocols.allowFile(track.path);
  // Lo que ya no esta en disco tampoco tiene que seguir en "seguir viendo":
  // sin esto la lista se llena de peliculas borradas que al pulsarlas fallan.
  const vivos = new Set(library.all().map((t) => t.id));
  progreso?.podar(vivos);
  collections?.prune(vivos);
  enviar('library:changed', { total: library.size() });
}

async function abrirArchivos(files) {
  if (!files.length || !library || !mainWindow || mainWindow.isDestroyed()) return;
  const tracks = await library.addFiles(files);
  if (!tracks.length) return;
  mainWindow.webContents.send('app:open-files', tracks.map(paraCliente));

  // Abrir desde el Explorador mete el video en la biblioteca igual que
  // soltarlo en la ventana, asi que hay que avisar de que cambio. Sin esto
  // se reproducia pero no salia en la lista hasta reiniciar la app: parecia
  // que abrirlo con Reele ya puesto "no habia hecho nada".
  mainWindow.webContents.send('library:changed', { total: library.size() });
}
