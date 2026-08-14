'use strict';

const { ipcMain, shell, app } = require('electron');

const {
  applyBackdrop,
  setMiniPlayer,
  setPantallaCompleta,
  togglePantallaCompleta,
} = require('./window');
const { VIDEO_EXTENSIONS, SUBTITLE_EXTENSIONS, VELOCIDADES } = require('./defaults');

/**
 * Registra los handlers del proceso principal.
 * `ctx` lleva { getWindow, settings }.
 */
function registerIpc(ctx) {
  const { getWindow, settings } = ctx;

  const withWindow = (fn) => (...args) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return null;
    return fn(win, ...args);
  };

  const emitir = (canal, datos) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(canal, datos);
  };

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

  // --- Ajustes ------------------------------------------------------------
  ipcMain.handle('settings:all', () => settings.all());

  ipcMain.handle('settings:set', (_e, patch) => {
    if (!patch || typeof patch !== 'object') return settings.all();
    settings.merge(patch);
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

module.exports = { registerIpc };
