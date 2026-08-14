/**
 * Lo que Reele le cuenta al sistema, y lo que el sistema le manda.
 *
 * Dos piezas que van juntas porque comparten el mismo parte de estado:
 *
 *   - La barra de tareas de Windows: los botones de la miniatura y el
 *     distintivo del icono los pinta el proceso principal, pero no sabe nada
 *     de la cola. La pagina se lo va contando.
 *   - La sesion de medios: en Windows 11 es lo que alimenta el panel que sale
 *     al pulsar una tecla multimedia, y es tambien lo que hace que esas
 *     teclas lleguen aqui.
 *
 * La alternativa a la sesion de medios habria sido `globalShortcut` en el
 * proceso principal, que secuestra las teclas a nivel de sistema: con eso
 * Reele se quedaria el play/pausa aunque quien este sonando sea otro
 * programa. La sesion de medios es lo contrario: Windows sabe quien manda y
 * le pasa la tecla a ese.
 */

export function initSistema(motor, { activo = true } = {}) {
  const barra = initBarraTareas(motor);
  const sesion = initSesionMedios(motor, { activo });

  return {
    avisar: barra.avisar,
    setMediaKeys: sesion.setActivo,
    sesionDisponible: sesion.disponible,
  };
}

// --- Barra de tareas --------------------------------------------------------

function initBarraTareas(motor) {
  const { player, queue } = motor;
  const puente = window.reele.player;
  if (!puente) return { avisar() {} };

  const foto = () => ({
    // El id, no el titulo: el proceso principal ya tiene el video entero en
    // la biblioteca y asi no hay dos copias de los datos que puedan divergir.
    id: player.track?.id ?? null,
    hayVideo: !!player.track,
    viendo: player.playing,
    // Con repeticion de toda la cola siempre hay siguiente, aunque sea el
    // primero: el boton no debe apagarse al llegar al final.
    hayPrev: queue.length > 0,
    hayNext: queue.length > 0 && (queue.repeat !== 'off' || queue.index < queue.length - 1),
  });

  const avisar = () => puente.report(foto());

  player.on('trackchange', avisar);
  player.on('state', avisar);
  queue.on('mode', avisar);
  queue.on('change', avisar);

  puente.onCommand(({ orden }) => {
    if (orden === 'prev') queue.prev();
    else if (orden === 'next') queue.next();
    else if (orden === 'toggle') {
      // Igual que el boton de la ventana: sin nada cargado, arranca la cola.
      if (!player.track && queue.length) queue.playAt(Math.max(0, queue.index));
      else player.toggle();
    }
  });

  avisar();
  return { avisar };
}

// --- Sesion de medios -------------------------------------------------------

const SIN_SESION = { setActivo() {}, disponible: false };

function initSesionMedios(motor, { activo }) {
  if (!('mediaSession' in navigator)) return SIN_SESION;

  const ms = navigator.mediaSession;
  const { player, queue } = motor;

  function pintarMetadatos(track) {
    if (!track) {
      ms.metadata = null;
      return;
    }
    const base = {
      title: track.title || 'Sin titulo',
      artist: etiquetaEpisodio(track) || track.folder || '',
      album: track.folder || '',
    };
    // El texto va ya, sin esperar al fotograma: cambiar de video tiene que
    // verse en el panel del sistema en el acto.
    ms.metadata = new MediaMetadata({ ...base, artwork: [] });
    if (!track.thumbUrl) return;

    urlDeMiniatura(track.thumbUrl).then((imagen) => {
      // El fotograma llega tarde a proposito. Si mientras tanto ha entrado
      // otro video, este ya no pinta nada.
      if (!imagen || player.track?.id !== track.id) return;
      ms.metadata = new MediaMetadata({
        ...base,
        artwork: [{ src: imagen.url, type: imagen.tipo }],
      });
    }).catch(() => { /* sin imagen en el panel, el resto sigue */ });
  }

  function pintarEstado() {
    ms.playbackState = !player.track ? 'none' : player.playing ? 'playing' : 'paused';
  }

  function pintarPosicion() {
    const duration = player.duration;
    // El navegador tira TypeError si la posicion se pasa de la duracion o si
    // la duracion no es finita, y eso pasa de verdad: un mkv sin indice
    // informa Infinity hasta que acaba de descargarse.
    if (!Number.isFinite(duration) || duration <= 0) return;
    const position = Math.min(Math.max(player.currentTime, 0), duration);
    try {
      ms.setPositionState({ duration, position, playbackRate: player.rate || 1 });
    } catch { /* el video cambio entre la lectura y la escritura */ }
  }

  const actualizar = () => {
    pintarEstado();
    pintarPosicion();
  };

  const ACCIONES = {
    play: () => {
      if (!player.track && queue.length) queue.playAt(Math.max(0, queue.index));
      else player.play();
    },
    pause: () => player.pause(),
    stop: () => {
      player.pause();
      player.seek(0);
    },
    previoustrack: () => queue.prev(),
    nexttrack: () => queue.next(),
    seekto: (d) => {
      if (typeof d.seekTime === 'number') player.seek(d.seekTime);
    },
    seekbackward: (d) => player.seek(player.currentTime - (d.seekOffset || 10)),
    seekforward: (d) => player.seek(player.currentTime + (d.seekOffset || 10)),
  };

  /**
   * Engancha o suelta los mandos del sistema.
   *
   * Soltarlos es lo que hace de verdad el ajuste "teclas multimedia": la
   * ficha con el fotograma se sigue publicando, porque eso no molesta a
   * nadie, pero las teclas dejan de mandar sobre Reele.
   */
  function setActivo(encendido) {
    for (const [nombre, fn] of Object.entries(ACCIONES)) {
      try {
        // Un handler que tira una excepcion deja ese boton del panel muerto
        // hasta recargar la pagina, y sin ningun aviso: van todos envueltos.
        ms.setActionHandler(nombre, !encendido ? null : (detalles) => {
          try {
            fn(detalles || {});
          } catch (err) {
            console.warn('[sesion] la accion', nombre, 'fallo:', err.message);
          }
        });
      } catch {
        // Chromium rechaza las acciones que no conoce. No es un fallo: la
        // sesion sigue viva con las demas.
      }
    }
  }

  player.on('trackchange', ({ track }) => {
    pintarMetadatos(track);
    actualizar();
  });
  player.on('state', actualizar);
  player.on('duration', pintarPosicion);
  player.on('rate', pintarPosicion);
  // 'time' llega unas cuatro veces por segundo. Refrescar la posicion en cada
  // uno seria gratis para la barra de la ventana, pero esto cruza a otro
  // proceso: se manda una vez por segundo, que es lo que el panel refresca.
  let ultimo = 0;
  player.on('time', () => {
    const ahora = performance.now();
    if (ahora - ultimo < 1000) return;
    ultimo = ahora;
    pintarPosicion();
  });

  setActivo(activo);
  pintarMetadatos(player.track);
  actualizar();

  return { setActivo, disponible: true };
}

function etiquetaEpisodio(track) {
  if (!track.season && !track.episode) return null;
  const s = String(track.season ?? 1).padStart(2, '0');
  const e = String(track.episode ?? 1).padStart(2, '0');
  return `S${s}E${e}`;
}

/**
 * El fotograma en forma de blob.
 *
 * MediaImage solo admite http, https, data y blob: pasarle la URL de
 * `reele-thumb://` la rechaza en consola y el panel del sistema sale con el
 * cuadradito gris de siempre. Se descarga por fetch (la CSP ya deja
 * connect-src a ese esquema) y se convierte en un blob:, que si acepta.
 *
 * Se cachean unos cuantos porque los capitulos de una serie comparten
 * fotograma de cabecera, y crear una URL de objeto por video filtra memoria:
 * las URL de objeto no se liberan solas, hay que revocarlas.
 */
const cacheImagen = new Map();
const MAX_IMAGENES = 24;

async function urlDeMiniatura(thumbUrl) {
  const guardada = cacheImagen.get(thumbUrl);
  if (guardada) return guardada;

  const res = await fetch(thumbUrl);
  if (!res.ok) return null;
  const blob = await res.blob();
  const imagen = { url: URL.createObjectURL(blob), tipo: blob.type || 'image/jpeg' };

  cacheImagen.set(thumbUrl, imagen);
  if (cacheImagen.size > MAX_IMAGENES) {
    const [clave, vieja] = cacheImagen.entries().next().value;
    cacheImagen.delete(clave);
    URL.revokeObjectURL(vieja.url);
  }
  return imagen;
}
