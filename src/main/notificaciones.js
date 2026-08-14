'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Notification } = require('electron');

const protocols = require('./protocols');

/**
 * Aviso al empezar un video.
 *
 * Solo cuando la ventana no esta delante. Viendo algo, el aviso no cuenta
 * nada que no se lea ya en la propia pantalla.
 *
 * En un reproductor de video esto es mucho mas raro que en uno de musica: lo
 * normal es estar mirando. Donde si sirve es al encadenar capitulos con la
 * ventana de fondo o en el mini, para saber por cual va sin ir a buscarla.
 *
 * En Windows los avisos van firmados con el AppUserModelId, que main.js fija
 * al arrancar. Sin un acceso directo instalado con ese mismo identificador,
 * Windows los descarta en silencio: en desarrollo puede no salir ninguno y no
 * es un fallo del codigo. El instalador (electron-builder) crea ese acceso.
 */

/**
 * Ultimo video ya anunciado.
 *
 * Es "anunciado", no "visto", y la diferencia importa. El parte de un video
 * nuevo llega dos veces seguidas: la primera con `viendo` en falso, porque el
 * cambio se emite antes de que `play()` resuelva, y la segunda ya en marcha.
 * Apuntandolo en la primera, la segunda lo encontraba repetido y no avisaba
 * nunca nadie.
 */
let avisado = null;

/** El aviso vivo, para cerrarlo cuando llega el siguiente. */
let vivo = null;

function reiniciar() {
  avisado = null;
  cerrarVivo();
}

function cerrarVivo() {
  if (!vivo) return;
  try {
    vivo.close();
  } catch { /* ya se habia ido solo */ }
  vivo = null;
}

/**
 * `track` es el video tal cual vive en la biblioteca (con `thumb` como nombre
 * de archivo de la cache), no la version que ve el renderer.
 */
function avisarDeVideo(win, track, { activo = true, viendo = true } = {}) {
  if (!track || !viendo) return false;
  if (track.id === avisado) return false;
  // Se da por anunciado aunque no llegue a salir el globo. Si no, apagar el
  // ajuste y volver a encenderlo, o cambiar de ventana a mitad de pelicula,
  // soltaria el aviso de algo que lleva media hora puesto.
  avisado = track.id;

  if (!activo) return false;
  if (!Notification.isSupported()) return false;
  if (win && !win.isDestroyed() && win.isFocused() && win.isVisible()) return false;

  const icono = rutaDeMiniatura(track);
  const aviso = new Notification({
    title: track.title || 'Sin titulo',
    body: [etiquetaEpisodio(track), track.folder].filter(Boolean).join('\n') || 'Reele',
    icon: icono || undefined,
    silent: true, // un pitido encima de la pelicula no lo quiere nadie
    urgency: 'low',
  });

  aviso.on('click', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  cerrarVivo();
  vivo = aviso;
  aviso.show();
  return true;
}

function etiquetaEpisodio(track) {
  if (!track.season && !track.episode) return null;
  const s = String(track.season ?? 1).padStart(2, '0');
  const e = String(track.episode ?? 1).padStart(2, '0');
  return `S${s}E${e}`;
}

/** El fotograma ya extraido. Si no esta, el aviso sale con el icono de la app. */
function rutaDeMiniatura(track) {
  if (!track.thumb) return null;
  const dir = protocols.getThumbDir();
  if (!dir) return null;
  const completa = path.join(dir, path.basename(track.thumb));
  return fs.existsSync(completa) ? completa : null;
}

module.exports = { avisarDeVideo, reiniciar, rutaDeMiniatura };
