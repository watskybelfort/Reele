'use strict';

const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const { JsonStore } = require('./store');
const { DEFAULT_SETTINGS } = require('./defaults');
const { createMainWindow, setMiniPlayer } = require('./window');
const { registerIpc } = require('./ipc');
const { registerSchemes, registerHandlers } = require('./protocols');

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

  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    alFrente(mainWindow);
  });

  app.whenReady().then(async () => {
    settings = new JsonStore(
      path.join(app.getPath('userData'), 'settings.json'),
      DEFAULT_SETTINGS,
    );

    registerHandlers();
    registerIpc({ getWindow: () => mainWindow, settings });

    mainWindow = createMainWindow(settings);
    mainWindow.loadURL(APP_URL);

    if (settings.get('miniPlayer')) {
      mainWindow.once('ready-to-show', () => setMiniPlayer(mainWindow, true));
    }

    if (process.argv.includes('--dev')) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow(settings);
        mainWindow.loadURL(APP_URL);
      }
    });
  });

  app.on('window-all-closed', () => {
    cerrar();
    app.quit();
  });

  app.on('before-quit', () => cerrar());
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
}

module.exports = { alFrente };
