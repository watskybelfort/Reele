/**
 * Sondeo: abrir cada video para saber cuanto dura y sacarle una portada.
 *
 * Vive en el renderer porque es el unico sitio de la aplicacion donde hay un
 * decodificador de video. El proceso principal podria leer el contenedor a
 * mano, pero eso es escribir un demultiplexor de MP4 y de Matroska —o
 * arrastrar ffmpeg entero— para averiguar dos numeros y un fotograma.
 *
 * Se hace de uno en uno y en segundo plano. Decodificar es caro: dos videos
 * 4K a la vez compiten con el que el usuario esta viendo, y lo que se nota es
 * justo lo que no se puede permitir un reproductor, que la imagen se
 * entrecorte mientras la biblioteca "trabaja".
 */

/** Ancho de la miniatura. 480 se ve nitida en la lista y pesa unos 25 KB. */
const ANCHO_MINIATURA = 480;

/** Calidad del JPEG. Por encima de 0.85 solo crece el archivo. */
const CALIDAD = 0.82;

/**
 * Cuanto se espera a un archivo antes de darlo por perdido.
 *
 * Un video con la cabecera rota puede dejar al elemento esperando para
 * siempre sin emitir ni 'loadedmetadata' ni 'error'. Sin este limite, un
 * unico archivo malo congela el sondeo de toda la biblioteca.
 */
const LIMITE_MS = 15000;

/** Respiro entre videos para que la UI no se quede pillada. */
const RESPIRO_MS = 120;

export function crearSondeo(opciones = {}) {
  /**
   * `pausa` decide cuanto se espera entre un video y el siguiente.
   *
   * Existe para poder frenar el sondeo mientras se esta viendo algo. Parar
   * del todo seria peor: quien siempre tiene algo abierto no veria una sola
   * miniatura nunca. Asi sigue avanzando, pero despacio y sin robarle
   * decodificacion a la imagen que el usuario esta mirando.
   */
  const { onVideo, pausa = () => RESPIRO_MS } = opciones;

  let trabajando = false;
  let cancelado = false;

  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.preload = 'metadata';
  video.muted = true;
  // Sin esto Chromium puede negarse a decodificar el elemento por estar fuera
  // del documento; con muted y sin controles no molesta a nada.
  video.playsInline = true;

  const lienzo = document.createElement('canvas');
  const pincel = lienzo.getContext('2d', { alpha: false, willReadFrequently: false });

  async function arrancar() {
    if (trabajando) return 0;
    trabajando = true;
    cancelado = false;

    let hechos = 0;
    try {
      const pendientes = await window.reele.library.pendientes();
      for (const item of pendientes) {
        if (cancelado) break;
        const datos = await sondear(item);
        // Se manda SIEMPRE, tenga o no miniatura: el proceso principal marca
        // el video como sondeado y no lo vuelve a intentar en cada arranque.
        // Sin eso, un archivo que Chromium no sabe decodificar se reintenta
        // para siempre y el sondeo nunca se acaba.
        const actualizado = await window.reele.library.sondeado({ id: item.id, ...datos });
        if (actualizado) onVideo?.(actualizado);
        hechos++;
        await esperar(pausa());
      }
      if (hechos && !cancelado) await window.reele.library.finSondeo();
    } finally {
      trabajando = false;
      soltar();
    }
    return hechos;
  }

  /**
   * Un video, de principio a fin.
   *
   * Devuelve siempre un objeto, aunque este vacio: "no pude" tambien es un
   * resultado que hay que guardar.
   */
  async function sondear(item) {
    const salida = {};
    try {
      await conLimite(cargar(item.url), LIMITE_MS);

      if (Number.isFinite(video.duration) && video.duration > 0) salida.duration = video.duration;
      if (video.videoWidth) salida.width = video.videoWidth;
      if (video.videoHeight) salida.height = video.videoHeight;

      // Sin imagen no hay portada que sacar: un archivo solo de audio dentro
      // de un contenedor de video llega hasta aqui perfectamente.
      if (!video.videoWidth || !video.videoHeight) return salida;

      await conLimite(situar(instantePortada(video.duration)), LIMITE_MS);
      salida.thumb = await dibujar();
    } catch (err) {
      console.warn('[sondeo] me rindo con', item.fileName ?? item.id, '-', err.message);
    } finally {
      soltar();
    }
    return salida;
  }

  function cargar(url) {
    return new Promise((resolve, reject) => {
      const limpiar = () => {
        video.removeEventListener('loadedmetadata', ok);
        video.removeEventListener('error', mal);
      };
      const ok = () => { limpiar(); resolve(); };
      const mal = () => { limpiar(); reject(new Error(mensajeError(video.error))); };
      video.addEventListener('loadedmetadata', ok, { once: true });
      video.addEventListener('error', mal, { once: true });
      video.src = url;
      video.load();
    });
  }

  function situar(segundos) {
    return new Promise((resolve, reject) => {
      const limpiar = () => {
        video.removeEventListener('seeked', ok);
        video.removeEventListener('error', mal);
      };
      const ok = () => { limpiar(); resolve(); };
      const mal = () => { limpiar(); reject(new Error('no pude saltar')); };
      video.addEventListener('seeked', ok, { once: true });
      video.addEventListener('error', mal, { once: true });
      try {
        video.currentTime = segundos;
      } catch (err) {
        limpiar();
        reject(err);
      }
    });
  }

  async function dibujar() {
    const escala = Math.min(1, ANCHO_MINIATURA / video.videoWidth);
    lienzo.width = Math.max(1, Math.round(video.videoWidth * escala));
    lienzo.height = Math.max(1, Math.round(video.videoHeight * escala));
    pincel.drawImage(video, 0, 0, lienzo.width, lienzo.height);

    const blob = await new Promise((resolve) => lienzo.toBlob(resolve, 'image/jpeg', CALIDAD));
    if (!blob) throw new Error('el lienzo no dio imagen');
    return blob.arrayBuffer();
  }

  /**
   * Suelta el archivo.
   *
   * No es limpieza opcional: mientras el elemento conserve el src, Chromium
   * mantiene el descriptor abierto y Windows no deja mover ni borrar ese
   * archivo. Con una biblioteca entera sondeada, eso serian miles de
   * archivos bloqueados por el reproductor.
   */
  function soltar() {
    video.removeAttribute('src');
    video.load();
  }

  return {
    arrancar,
    cancelar() { cancelado = true; },
    get trabajando() { return trabajando; },
  };
}

/**
 * De donde se saca el fotograma.
 *
 * No del principio: los primeros segundos de casi cualquier video son negro,
 * un logotipo o una cortinilla, y una biblioteca entera de rectangulos
 * negros no ayuda a encontrar nada. Un diez por ciento dentro ya suele haber
 * imagen de verdad, con un tope para que en una pelicula de dos horas no
 * haya que saltar doce minutos —cada salto es una peticion de rango y una
 * busqueda en el archivo— y un minimo para los videos muy cortos.
 */
function instantePortada(duracion) {
  if (!Number.isFinite(duracion) || duracion <= 0) return 1;
  if (duracion <= 4) return duracion / 2;
  return Math.min(Math.max(duracion * 0.1, 2), 90);
}

function conLimite(promesa, ms) {
  return Promise.race([
    promesa,
    new Promise((_, reject) => setTimeout(() => reject(new Error('se acabo el tiempo')), ms)),
  ]);
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ERRORES = {
  1: 'carga cancelada',
  2: 'error de red',
  3: 'no se pudo decodificar',
  4: 'formato no soportado o archivo inaccesible',
};

function mensajeError(err) {
  if (!err) return 'error desconocido';
  return ERRORES[err.code] || err.message || 'error desconocido';
}
