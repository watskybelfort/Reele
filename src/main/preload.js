'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * Unico puente entre la pagina y el proceso principal.
 *
 * El preload corre en sandbox y con contextIsolation, asi que la pagina
 * nunca ve `require` ni el modulo `electron`: solo estos metodos.
 */

/** Suscribe a un canal y devuelve la funcion para darse de baja. */
function on(channel, handler) {
  const wrapped = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

/**
 * Los archivos de "Abrir con..." se guardan hasta que la pagina los pida.
 *
 * El proceso principal los manda en cuanto termina de cargar el documento,
 * pero el arranque del renderer es asincrono: para cuando boot() ha leido los
 * ajustes y montado la biblioteca, ese aviso ya paso y no lo escucho nadie.
 * El sintoma era el peor posible para un reproductor predeterminado: doble
 * clic en una pelicula, se abre Reele, y se queda en la pantalla de inicio.
 * Con la app ya abierta si funcionaba, que es lo que despista.
 *
 * El preload se ejecuta ANTES que cualquier script de la pagina, asi que
 * suscribirse aqui llega siempre a tiempo.
 */
const archivosPendientes = [];
let alRecibirArchivos = null;

ipcRenderer.on('app:open-files', (_event, tracks) => {
  if (alRecibirArchivos) alRecibirArchivos(tracks);
  else archivosPendientes.push(tracks);
});

contextBridge.exposeInMainWorld('reele', {
  // --- Ventana ------------------------------------------------------------
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    setMini: (enabled) => ipcRenderer.invoke('window:set-mini', enabled),
    setPantalla: (activa) => ipcRenderer.invoke('window:set-fullscreen', activa),
    togglePantalla: () => ipcRenderer.invoke('window:toggle-fullscreen'),
    getState: () => ipcRenderer.invoke('window:get-state'),
    onState: (h) => on('window:state', h),
    onFocus: (h) => on('window:focus', h),
    onMini: (h) => on('window:mini', h),
    onPantalla: (h) => on('window:fullscreen', h),
  },

  // --- Reproduccion en el sistema -----------------------------------------
  player: {
    /** Avisa de como va: barra de tareas, bandeja, avisos y pantalla. */
    report: (estado) => ipcRenderer.send('player:state', estado),
    onCommand: (h) => on('player:command', h),
  },

  // --- Ajustes ------------------------------------------------------------
  settings: {
    all: () => ipcRenderer.invoke('settings:all'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    onChange: (h) => on('settings:changed', h),
  },

  // --- Vidrio -------------------------------------------------------------
  backdrop: {
    apply: (mode) => ipcRenderer.invoke('backdrop:apply', mode),
  },

  // --- Biblioteca ---------------------------------------------------------
  library: {
    all: () => ipcRenderer.invoke('library:all'),
    folders: () => ipcRenderer.invoke('library:folders'),
    scan: () => ipcRenderer.invoke('library:scan'),
    cancelScan: () => ipcRenderer.invoke('library:cancel-scan'),
    addFolder: () => ipcRenderer.invoke('library:add-folder'),
    removeFolder: (folder) => ipcRenderer.invoke('library:remove-folder', folder),
    openFiles: () => ipcRenderer.invoke('library:open-files'),
    addPaths: (paths) => ipcRenderer.invoke('library:add-paths', paths),
    reveal: (file) => ipcRenderer.invoke('library:reveal', file),
    onProgress: (h) => on('library:progress', h),
    onChanged: (h) => on('library:changed', h),

    // --- Sondeo -----------------------------------------------------------
    pendientes: () => ipcRenderer.invoke('library:pending'),
    sondeado: (datos) => ipcRenderer.invoke('library:probed', datos),
    finSondeo: () => ipcRenderer.invoke('library:probe-done'),
    onEnriquecido: (h) => on('library:enriched', h),

    /**
     * Desde Electron 32 los objetos File ya no traen `.path`. La unica via
     * legitima para saber que se solto es esta, y solo existe en el preload.
     */
    pathsFromDrop: (fileList) => {
      const salida = [];
      for (const file of fileList) {
        try {
          const p = webUtils.getPathForFile(file);
          if (p) salida.push(p);
        } catch { /* no era un archivo real del disco */ }
      }
      return salida;
    },
  },

  // --- Por donde iba ------------------------------------------------------
  progreso: {
    de: (id) => ipcRenderer.invoke('prog:for', id),
    fracciones: () => ipcRenderer.invoke('prog:fractions'),
    seguirViendo: (limite) => ipcRenderer.invoke('prog:continue', limite),
    olvidar: (id) => ipcRenderer.invoke('prog:forget', id),
    visto: (id, duracion) => ipcRenderer.invoke('prog:seen', id, duracion),
    guardar: (id, t, dur) => ipcRenderer.send('prog:save', id, t, dur),
  },

  // --- Subtitulos ---------------------------------------------------------
  subtitulos: {
    para: (videoId) => ipcRenderer.invoke('subs:for', videoId),
    leer: (videoId, subId) => ipcRenderer.invoke('subs:read', videoId, subId),
  },

  // --- App ----------------------------------------------------------------
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    constants: () => ipcRenderer.invoke('app:constants'),
    abrirExterno: (url) => ipcRenderer.invoke('app:open-external', url),

    onOpenFiles: (h) => {
      alRecibirArchivos = h;
      // Lo que llego mientras la pagina arrancaba se entrega ahora, en orden.
      while (archivosPendientes.length) h(archivosPendientes.shift());
      return () => { alRecibirArchivos = null; };
    },
  },

  // --- Entorno ------------------------------------------------------------
  env: {
    platform: process.platform,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
  },
});
