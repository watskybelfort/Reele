/**
 * Motor de video.
 *
 * A diferencia del de Sounde, aqui hay UN solo elemento y no dos.
 *
 * Los dos "decks" de Sounde existen para el fundido cruzado y para que el
 * cambio de cancion no tenga hueco. En video ninguna de las dos cosas se
 * quiere: cruzar dos peliculas no significa nada, y precargar la siguiente
 * obligaria a tener dos decodificadores de video vivos a la vez, que en un
 * archivo 4K es medio gigabyte de memoria y un nucleo entero ocupado para
 * algo que casi nunca se va a usar. Un video se ve entero y se acaba.
 *
 * El elemento <video> lo crea el escenario y se pasa aqui: quien manda sobre
 * la imagen es la vista, y el motor solo se ocupa del transporte.
 */

import { crearEmisor } from './emitter.js';

export class Player {
  constructor(video) {
    const emisor = crearEmisor();
    this.on = emisor.on.bind(emisor);
    this.once = emisor.once.bind(emisor);
    this._emit = emisor.emit.bind(emisor);

    this.video = video;
    this.track = null;
    this.volume = 1;
    this.muted = false;
    this.rate = 1;

    // crossOrigin ANTES de cualquier src. No hace falta para reproducir, pero
    // si para leer los pixeles con drawImage: sin el, sacar el fotograma de
    // portada o el color dominante lanza una excepcion de lienzo contaminado.
    // Ver la nota de CORS en main/protocols.js.
    video.crossOrigin = 'anonymous';
    video.preload = 'metadata';
    video.preservesPitch = true;

    video.addEventListener('timeupdate', () => {
      this._emit('time', { current: this.currentTime, duration: this.duration, track: this.track });
    });
    video.addEventListener('durationchange', () => {
      this._emit('duration', { duration: this.duration, track: this.track });
    });
    video.addEventListener('loadedmetadata', () => {
      if (this._pendiente > 0) {
        try {
          video.currentTime = this._pendiente;
        } catch { /* el formato no deja saltar: se queda en cero */ }
        this._pendiente = 0;
      }
      this._emit('metadatos', {
        track: this.track,
        duration: this.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      });
      this._emit('duration', { duration: this.duration, track: this.track });
    });
    video.addEventListener('ended', () => this._emit('ended', { track: this.track }));
    video.addEventListener('play', () => this._emit('state', { playing: true, track: this.track }));
    video.addEventListener('pause', () => this._emit('state', { playing: false, track: this.track }));
    video.addEventListener('waiting', () => this._emit('buffering', { buffering: true, track: this.track }));
    video.addEventListener('playing', () => this._emit('buffering', { buffering: false, track: this.track }));
    video.addEventListener('ratechange', () => {
      // El navegador puede cambiar la velocidad por su cuenta al cargar otro
      // archivo. Se relee del elemento en vez de fiarse de lo apuntado.
      this.rate = video.playbackRate;
      this._emit('rate', { rate: this.rate });
    });
    video.addEventListener('error', () => {
      this._emit('error', {
        track: this.track,
        code: video.error?.code ?? null,
        message: mensajeError(video.error),
      });
    });

    /** Salto pedido antes de que hubiera metadatos para poder aplicarlo. */
    this._pendiente = 0;

    this._aplicarVolumen();
  }

  // --- Estado ---------------------------------------------------------------

  get playing() {
    return !!this.track && !this.video.paused && !this.video.ended;
  }

  get currentTime() {
    return this.video.currentTime || 0;
  }

  get duration() {
    const nativa = this.video.duration;
    if (Number.isFinite(nativa) && nativa > 0) return nativa;
    // Un mkv sin indice informa Infinity hasta que se descarga entero. Lo que
    // sondeo dejo apuntado en la biblioteca es lo unico util para pintar la
    // barra desde el primer segundo.
    return this.track?.duration || 0;
  }

  /** Segundos ya descargados desde la posicion actual, para pintar el buffer. */
  get buffered() {
    const t = this.video.currentTime;
    const rangos = this.video.buffered;
    for (let i = 0; i < rangos.length; i++) {
      if (rangos.start(i) <= t && t <= rangos.end(i)) return rangos.end(i);
    }
    return t;
  }

  // --- Transporte -----------------------------------------------------------

  /**
   * Carga `track` y lo pone en marcha.
   *
   * `startAt` es lo que hace posible "continuar donde lo dejaste": se guarda
   * como pendiente si aun no hay metadatos, porque asignar currentTime antes
   * de que se conozca la duracion no hace nada y el video empezaria de cero.
   */
  async playTrack(track, opciones = {}) {
    if (!track?.url) return false;

    const inicio = Math.max(0, opciones.startAt ?? 0);
    const mismo = this.track?.id === track.id && !this.video.error;

    this.track = track;
    if (!mismo) {
      this._pendiente = 0;
      this.video.src = track.url;
      this.video.load();
    }
    this.video.playbackRate = this.rate;

    this._emit('trackchange', { track, duration: this.duration });
    this._situar(inicio);

    if (opciones.autoplay === false) return true;

    try {
      await this.video.play();
    } catch (err) {
      // AbortError sale cuando se cambia de video antes de que el play
      // anterior resuelva. No es un fallo: la peticion se quedo obsoleta.
      if (err.name !== 'AbortError') {
        this._emit('error', { track, message: err.message });
        return false;
      }
    }
    return true;
  }

  async play() {
    if (!this.track) return false;
    try {
      await this.video.play();
    } catch (err) {
      if (err.name !== 'AbortError') {
        this._emit('error', { track: this.track, message: err.message });
        return false;
      }
    }
    return true;
  }

  pause() {
    this.video.pause();
  }

  toggle() {
    if (this.playing) {
      this.pause();
      return false;
    }
    this.play();
    return true;
  }

  stop() {
    this.video.pause();
    this.track = null;
    // removeAttribute + load, no `src = ''`: la cadena vacia se resuelve
    // contra la URL de la pagina y dispara un error de carga falso.
    this.video.removeAttribute('src');
    this.video.load();
    this._emit('trackchange', { track: null, duration: 0 });
    this._emit('state', { playing: false, track: null });
  }

  seek(segundos) {
    if (!this.track) return;
    const dur = this.duration;
    const destino = clamp(segundos, 0, dur > 0 ? Math.max(0, dur - 0.25) : segundos);
    this._situar(destino);
    this._emit('time', { current: destino, duration: dur, track: this.track });
  }

  /** Salto relativo, que es como se navega un video de verdad. */
  saltar(segundos) {
    this.seek(this.currentTime + segundos);
  }

  // --- Mandos ---------------------------------------------------------------

  setVolume(v) {
    this.volume = clamp(Number(v) || 0, 0, 1);
    this._aplicarVolumen();
    // Avisar no es opcional: el volumen se cambia desde el mando, desde el
    // teclado y desde los ajustes, y sin evento el mando se queda quieto
    // mientras el sonido sube, que parece que el atajo no funciona.
    this._emit('volumen', { volume: this.volume, muted: this.muted });
    return this.volume;
  }

  setMuted(m) {
    this.muted = !!m;
    this._aplicarVolumen();
    this._emit('volumen', { volume: this.volume, muted: this.muted });
    return this.muted;
  }

  setRate(r) {
    this.rate = clamp(Number(r) || 1, 0.25, 4);
    // Sin esto, acelerar la reproduccion sube el tono y los dialogos suenan
    // a ardilla, que es exactamente lo que nadie quiere al ver algo a 1.5x.
    this.video.preservesPitch = true;
    this.video.playbackRate = this.rate;
    return this.rate;
  }

  /** Aplica de golpe lo que venga de los ajustes guardados. */
  aplicarAjustes(a = {}) {
    if (a.volume !== undefined) this.setVolume(a.volume);
    if (a.muted !== undefined) this.setMuted(a.muted);
    if (a.playbackRate !== undefined) this.setRate(a.playbackRate);
  }

  // --- Interioridades -------------------------------------------------------

  /** Coloca el cabezal, esperando a los metadatos si aun no han llegado. */
  _situar(segundos) {
    if (segundos <= 0) return;
    if (this.video.readyState >= 1) {
      try {
        this.video.currentTime = segundos;
        return;
      } catch { /* cae al camino de abajo */ }
    }
    this._pendiente = segundos;
  }

  /**
   * El oido no es lineal: con ganancia lineal, la mitad del recorrido del
   * mando ya suena casi a tope y todo el ajuste fino se apelotona abajo. La
   * curva cuadratica reparte el recorrido de forma que se sienta parejo.
   */
  _aplicarVolumen() {
    this.video.muted = this.muted;
    this.video.volume = this.volume * this.volume;
  }
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
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
