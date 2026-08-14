'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { BrowserWindow, nativeTheme, screen } = require('electron');

const { iconoVentana } = require('./iconos');

const ROOT = path.join(__dirname, '..', '..');
const NATIVE_SCRIPT = path.join(ROOT, 'tools', 'acrylic-native.ps1');

// Mas grande que en Sounde a proposito: aqui el contenido principal es una
// imagen con proporcion fija, y por debajo de esto el video queda del tamano
// de un sello entre el lateral y la lista.
const MAIN_MIN = { width: 1000, height: 660 };

/** Alto de la barra de titulo en mini. Tiene que casar con el CSS. */
const MINI_TITULO = 30;
/** 480x270 es 16:9 exacto; el alto total suma la barra de titulo. */
const MINI_SIZE = { width: 480, height: 270 + MINI_TITULO };
const MINI_MIN_WIDTH = 320;

/** Estado del ultimo tamano "grande", para volver desde el mini-player. */
let restoreBounds = null;

/** Ultimo modo de vidrio aplicado, para saber si hay que limpiar antes. */
let lastMode = null;

/**
 * `backdrop-filter` NO puede difuminar el escritorio: solo muestrea pixeles
 * que ya estan dentro de la pagina. Como la ventana de Reele compone con
 * alfa, el desenfoque del escritorio lo pone DWM sobre la ventana entera y
 * el CSS se limita a NO pintar opaco.
 *
 * Por eso `backdrop-filter` en esta app vive unicamente en menus, modales y
 * tooltips: ahi si hay pixeles de la propia UI debajo que difuminar.
 */
function createMainWindow(settings) {
  const saved = settings.get('bounds');
  const bounds = isOnScreen(saved) ? saved : null;

  const win = new BrowserWindow({
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 800,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: MAIN_MIN.width,
    minHeight: MAIN_MIN.height,
    show: false,
    frame: false,
    // transparent:true apagaria el backdrop del sistema. La ventana tiene que
    // ser opaca "para Electron" y llevar el color de fondo con alfa 0 para
    // que DWM sea quien componga el acrilico.
    transparent: false,
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    roundedCorners: true,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    title: 'Reele',
    icon: iconoVentana(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // Un video de fondo no se puede permitir que Chromium le baje la
      // prioridad a los temporizadores: la barra de progreso se congelaria y
      // el guardado de "por donde iba" dejaria de correr.
      backgroundThrottling: false,
    },
  });

  win.setMenuBarVisibility(false);
  nativeTheme.themeSource = 'dark';

  if (settings.get('maximized')) win.maximize();

  win.once('ready-to-show', () => win.show());

  const persist = debounce(() => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    const maximized = win.isMaximized();
    settings.set('maximized', maximized);
    if (!maximized && !isMini(win)) settings.set('bounds', win.getBounds());
  }, 400);

  win.on('resize', persist);
  win.on('move', persist);
  win.on('maximize', () => emit(win, 'window:state', { maximized: true }));
  win.on('unmaximize', () => emit(win, 'window:state', { maximized: false }));

  // La pagina necesita saberlo para esconder su propio marco y sacar los
  // mandos flotantes sobre el video. Sin el aviso, en pantalla completa se
  // quedaria la barra de titulo pintada encima de la pelicula.
  win.on('enter-full-screen', () => emit(win, 'window:fullscreen', { pantalla: true }));
  win.on('leave-full-screen', () => emit(win, 'window:fullscreen', { pantalla: false }));

  // Windows apaga el acrilico del sistema cuando la ventana pierde el foco.
  // No es un fallo: hay que avisarle a la UI para que compense la veladura,
  // o al desenfocar parece que el tema se rompio.
  win.on('focus', () => emit(win, 'window:focus', { focused: true }));
  win.on('blur', () => emit(win, 'window:focus', { focused: false }));

  applyBackdrop(win, settings);
  return win;
}

/**
 * Aplica el backdrop segun ajustes.
 *
 * 'acrylic' | 'mica' | 'tabbed' | 'none' los resuelve Electron contra DWM.
 * 'acrylic-always' baja a la capa nativa porque es el unico modo que
 * sobrevive a perder el foco.
 */
function applyBackdrop(win, settings) {
  const mode = settings.get('backdrop', 'acrylic');
  const native = mode === 'acrylic-always';

  // El Off nativo SOLO se usa para salir del modo nativo. Lanzarlo siempre
  // "por limpieza" rompe justo lo que se queria arreglar: recoge el marco
  // extendido a margenes 0 y deja DWMWA_SYSTEMBACKDROP_TYPE en None, y
  // setBackgroundMaterial no lo vuelve a extender. El sintoma es enganoso:
  // la ventana queda transparente y el escritorio se ve detras perfecto, a
  // filo, sin una gota de desenfoque.
  const veniaDeNativo = lastMode === 'acrylic-always';
  lastMode = mode;

  const aplicar = () => {
    if (win.isDestroyed()) return;
    try {
      if (native) {
        win.setBackgroundMaterial('none');
        runNative('Acrylic', settings);
      } else {
        win.setBackgroundMaterial(mode);
      }
    } catch (err) {
      console.error('[backdrop] setBackgroundMaterial fallo:', err.message);
    }
  };

  if (veniaDeNativo) runNative('Off', settings, aplicar);
  else aplicar();

  return mode;
}

function runNative(mode, settings, done) {
  const args = [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', NATIVE_SCRIPT,
    '-TargetPid', String(process.pid),
    '-Mode', mode,
    '-Tint', settings.get('backdropTint', '#0E1116'),
    '-Alpha', String(settings.get('backdropAlpha', 96)),
  ];
  execFile('powershell.exe', args, { windowsHide: true, timeout: 15000 }, (err, stdout) => {
    if (err) console.error('[backdrop] capa nativa fallo:', err.message);
    else if (stdout) console.log('[backdrop]', stdout.trim());
    if (done) done();
  });
}

/**
 * Pantalla completa de verdad, la de la ventana, no la del DOM.
 *
 * La del DOM (`requestFullscreen`) deja el marco de Electron por debajo y en
 * una ventana sin marco como esta se nota en las esquinas redondeadas. Esta
 * ademas es la que entiende Windows: oculta la barra de tareas y aparece en
 * el conmutador como una aplicacion a pantalla completa.
 */
function setPantallaCompleta(win, activa) {
  if (win.isDestroyed()) return false;
  const valor = !!activa;
  // Con el mini puesto no tiene sentido: es una ventana flotante de 480 de
  // ancho que ademas tiene el tamano clavado.
  if (valor && isMini(win)) return false;
  win.setFullScreen(valor);
  return valor;
}

function togglePantallaCompleta(win) {
  if (win.isDestroyed()) return false;
  return setPantallaCompleta(win, !win.isFullScreen());
}

/**
 * Mini-player: una ventana flotante con el video y nada mas.
 *
 * La proporcion se clava a 16:9 descontando la barra de titulo, asi que
 * arrastrar una esquina la agranda sin deformar la imagen ni dejar bandas
 * negras que en una ventana de 480 se comen media pelicula.
 */
function setMiniPlayer(win, enabled) {
  if (win.isDestroyed()) return false;
  if (enabled) {
    if (win.isFullScreen()) win.setFullScreen(false);
    if (win.isMaximized()) win.unmaximize();
    // Solo se apunta el tamano grande si veniamos de el. Entrar dos veces en
    // mini guardaria las medidas del propio mini y ya no habria vuelta.
    if (!isMini(win)) restoreBounds = win.getBounds();
    win.setMinimumSize(MINI_MIN_WIDTH, Math.round((MINI_MIN_WIDTH * 9) / 16) + MINI_TITULO);
    win.setMaximumSize(0, 0);
    win.setSize(MINI_SIZE.width, MINI_SIZE.height, true);
    win.setAspectRatio(16 / 9, { width: 0, height: MINI_TITULO });
    // Ojo al depurar esto: mientras haya un juego a pantalla completa en
    // primer plano, Windows no deja TOPMOST a nadie mas y esta llamada no
    // hace nada, sin dar error. La ventana sale bien y solo falla el flotar,
    // que es justo lo que despista.
    win.setAlwaysOnTop(true, 'floating');
    win.setMaximizable(false);
  } else {
    win.setAlwaysOnTop(false);
    win.setMaximizable(true);
    // Soltar la proporcion ANTES de redimensionar: con 16:9 todavia puesto,
    // el setSize de abajo se recorta contra ella y la ventana vuelve del mini
    // con el alto de una pantalla ancha.
    win.setAspectRatio(0);
    win.setMinimumSize(MAIN_MIN.width, MAIN_MIN.height);
    const b = restoreBounds ?? { width: 1280, height: 800 };
    win.setSize(b.width, b.height, true);
    if (restoreBounds) win.setPosition(restoreBounds.x, restoreBounds.y, true);
  }
  emit(win, 'window:mini', { mini: enabled });
  return enabled;
}

function isMini(win) {
  return win.isAlwaysOnTop() && !win.isFullScreen() && win.getSize()[0] <= MINI_SIZE.width + 400;
}

/** Una ventana guardada en un monitor que ya no existe abre fuera de pantalla. */
function isOnScreen(bounds) {
  if (!bounds || typeof bounds.x !== 'number') return false;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return (
      bounds.x < a.x + a.width &&
      bounds.x + bounds.width > a.x &&
      bounds.y < a.y + a.height &&
      bounds.y + bounds.height > a.y
    );
  });
}

function emit(win, channel, payload) {
  if (!win.isDestroyed()) win.webContents.send(channel, payload);
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

module.exports = {
  createMainWindow,
  applyBackdrop,
  setMiniPlayer,
  setPantallaCompleta,
  togglePantallaCompleta,
  runNative,
  MINI_SIZE,
};
