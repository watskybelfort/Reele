/**
 * Cola de reproduccion.
 *
 * `items` es el orden real en que se van a ver los videos, que es exactamente
 * lo que muestra el panel de Cola. El aleatorio no es una capa que traduce
 * indices por detras: baraja la lista de verdad, asi que lo que se ve es lo
 * que va a sonar. `original` guarda el orden sin barajar para deshacerlo.
 *
 * El motor no sabe nada de esto. La cola escucha su aviso de 'ended' y le va
 * diciendo que toca.
 */

import { crearEmisor } from './emitter.js';

/** Antes de este punto, "anterior" reinicia el video en vez de retroceder. */
const REINICIO = 5;

/** Archivos rotos seguidos antes de rendirse y parar. */
const MAX_FALLOS = 5;

export class Queue {
  constructor(player) {
    const emisor = crearEmisor();
    this.on = emisor.on.bind(emisor);
    this._emit = emisor.emit.bind(emisor);

    this.player = player;
    this.items = [];
    this.original = [];
    this.index = -1;
    this.shuffle = false;
    this.repeat = 'off'; // 'off' | 'all' | 'one'
    this.autoplay = true;
    this.fallos = 0;

    player.on('ended', () => this._avanzarAuto());

    player.on('error', ({ track, message }) => {
      this.fallos++;
      this._emit('skip', { track, message });
      if (this.fallos > MAX_FALLOS) {
        this._emit('end', { reason: 'demasiados-errores' });
        return;
      }
      this._avanzarAuto();
    });

    player.on('state', ({ playing }) => {
      if (playing) this.fallos = 0;
    });
  }

  // --- Lectura --------------------------------------------------------------

  get current() {
    return this.items[this.index] ?? null;
  }

  get length() {
    return this.items.length;
  }

  /** Que vendria despues, sin tocar nada. */
  peekNext() {
    if (!this.items.length) return null;
    if (this.repeat === 'one') return this.current;
    if (this.index + 1 < this.items.length) return this.items[this.index + 1];
    if (this.repeat === 'all') return this.items[0];
    return null;
  }

  snapshot() {
    return {
      items: this.items,
      index: this.index,
      shuffle: this.shuffle,
      repeat: this.repeat,
      current: this.current,
    };
  }

  // --- Contexto -------------------------------------------------------------

  /**
   * Sustituye la cola entera. Es lo que pasa al abrir un video de una lista:
   * se ve ese y la cola pasa a ser esa lista, no solo ese archivo.
   */
  async setContext(videos, opciones = {}) {
    const lista = (videos || []).filter((t) => t?.url);
    if (!lista.length) {
      this.clear();
      return false;
    }

    this.original = [...lista];
    this.items = [...lista];

    let inicio = 0;
    if (opciones.startId) inicio = Math.max(0, this.items.findIndex((t) => t.id === opciones.startId));
    else if (Number.isInteger(opciones.startIndex)) inicio = clamp(opciones.startIndex, 0, this.items.length - 1);

    if (this.shuffle) {
      // El elegido se queda primero y el resto se baraja: abrir un video con
      // el aleatorio puesto tiene que abrir ESE, no otro cualquiera.
      const elegido = this.items[inicio];
      const resto = this.items.filter((_, i) => i !== inicio);
      this.items = [elegido, ...barajar(resto)];
      inicio = 0;
    }

    this.index = inicio;
    this.fallos = 0;
    this._emit('change', this.snapshot());
    if (opciones.autoplay === false) {
      this._emit('track', { track: this.current, index: this.index });
      return true;
    }
    return this._reproducirActual(opciones);
  }

  async playAt(i, opciones = {}) {
    if (i < 0 || i >= this.items.length) return false;
    this.index = i;
    this._emit('change', this.snapshot());
    return this._reproducirActual(opciones);
  }

  async playId(id, opciones = {}) {
    const i = this.items.findIndex((t) => t.id === id);
    return i >= 0 ? this.playAt(i, opciones) : false;
  }

  // --- Navegacion -----------------------------------------------------------

  async next() {
    if (!this.items.length) return false;

    if (this.index + 1 < this.items.length) this.index++;
    else if (this.repeat !== 'off') this.index = 0;
    else return this._terminar();

    this._emit('change', this.snapshot());
    return this._reproducirActual();
  }

  async prev() {
    if (!this.items.length) return false;

    // El gesto clasico: si ya lleva un rato, "anterior" significa "vuelve a
    // empezar este", no "salta al de antes". En video el margen es mas ancho
    // que en musica porque los cinco primeros segundos suelen ser logotipos.
    if (this.player.currentTime > REINICIO) {
      this.player.seek(0);
      return true;
    }

    if (this.index > 0) this.index--;
    else if (this.repeat === 'all') this.index = this.items.length - 1;
    else {
      this.player.seek(0);
      return true;
    }

    this._emit('change', this.snapshot());
    return this._reproducirActual();
  }

  // --- Modos ----------------------------------------------------------------

  setShuffle(activo) {
    activo = !!activo;
    if (activo === this.shuffle) return this.shuffle;
    this.shuffle = activo;

    const actual = this.current;
    if (activo) {
      // Solo se baraja lo que falta. Tocar lo ya visto haria que "anterior"
      // saltase a videos que nunca se abrieron.
      const cabeza = this.items.slice(0, this.index + 1);
      const cola = barajar(this.items.slice(this.index + 1));
      this.items = [...cabeza, ...cola];
    } else {
      this.items = [...this.original];
      if (actual) {
        const i = this.items.findIndex((t) => t.id === actual.id);
        if (i >= 0) this.index = i;
      }
    }

    this._emit('change', this.snapshot());
    this._emit('mode', { shuffle: this.shuffle, repeat: this.repeat });
    return this.shuffle;
  }

  toggleShuffle() {
    return this.setShuffle(!this.shuffle);
  }

  setRepeat(modo) {
    this.repeat = ['off', 'all', 'one'].includes(modo) ? modo : 'off';
    this._emit('mode', { shuffle: this.shuffle, repeat: this.repeat });
    return this.repeat;
  }

  /** off -> all -> one -> off, que es el ciclo que espera todo el mundo. */
  cycleRepeat() {
    const orden = ['off', 'all', 'one'];
    return this.setRepeat(orden[(orden.indexOf(this.repeat) + 1) % orden.length]);
  }

  /**
   * Encadenar solo o parar al terminar cada video.
   *
   * En musica encadenar es lo natural. En video no siempre: al terminar un
   * capitulo mucha gente quiere que pare ahi, no que arranque el siguiente
   * a los dos segundos. Por eso es un ajuste y no una constante.
   */
  setAutoplay(activo) {
    this.autoplay = !!activo;
    return this.autoplay;
  }

  // --- Edicion --------------------------------------------------------------

  /** Justo despues del actual: "ver a continuacion". */
  addNext(videos) {
    const nuevos = normalizar(videos);
    if (!nuevos.length) return 0;
    const at = this.index + 1;
    this.items.splice(at, 0, ...nuevos);
    this.original.push(...nuevos);
    if (this.index < 0) this.index = 0;
    this._emit('change', this.snapshot());
    return nuevos.length;
  }

  addLast(videos) {
    const nuevos = normalizar(videos);
    if (!nuevos.length) return 0;
    this.items.push(...nuevos);
    this.original.push(...nuevos);
    if (this.index < 0) this.index = 0;
    this._emit('change', this.snapshot());
    return nuevos.length;
  }

  removeAt(i) {
    if (i < 0 || i >= this.items.length) return false;
    const [fuera] = this.items.splice(i, 1);
    const enOriginal = this.original.findIndex((t) => t.id === fuera.id);
    if (enOriginal >= 0) this.original.splice(enOriginal, 1);

    if (i < this.index) this.index--;
    else if (i === this.index) {
      // Se ha quitado el que se estaba viendo: entra el que ocupa su hueco.
      this.index = Math.min(this.index, this.items.length - 1);
      if (this.index < 0) {
        this.clear();
        return true;
      }
      this._reproducirActual();
    }
    this._emit('change', this.snapshot());
    return true;
  }

  move(desde, hasta) {
    if (desde === hasta) return false;
    if (desde < 0 || desde >= this.items.length) return false;
    const destino = clamp(hasta, 0, this.items.length - 1);

    const actual = this.current;
    const [pieza] = this.items.splice(desde, 1);
    this.items.splice(destino, 0, pieza);
    // El indice sigue al video que se esta viendo, no a su posicion vieja:
    // arrastrar otra fila nunca debe cambiar lo que hay en pantalla.
    if (actual) this.index = this.items.findIndex((t) => t.id === actual.id);
    this._emit('change', this.snapshot());
    return true;
  }

  clear() {
    this.items = [];
    this.original = [];
    this.index = -1;
    this.player.stop();
    this._emit('change', this.snapshot());
    return true;
  }

  // --- Interioridades -------------------------------------------------------

  async _reproducirActual(opciones = {}) {
    const track = this.current;
    if (!track) return this._terminar();

    this._emit('track', { track, index: this.index });
    return this.player.playTrack(track, opciones);
  }

  async _avanzarAuto() {
    if (!this.items.length) return false;

    if (this.repeat === 'one') {
      // Repetir uno: vuelve a empezar sin mover el indice.
      return this._reproducirActual();
    }

    // Sin encadenado la cola se queda quieta donde estaba: el video termina y
    // ahi se acaba, que es lo que pide el ajuste.
    if (!this.autoplay) return this._terminar();

    if (this.index + 1 < this.items.length) this.index++;
    else if (this.repeat === 'all') this.index = 0;
    else return this._terminar();

    this._emit('change', this.snapshot());
    return this._reproducirActual();
  }

  _terminar() {
    this.player.pause();
    this._emit('end', { reason: 'fin-de-cola' });
    return false;
  }
}

// --- Utilidades -----------------------------------------------------------

/**
 * Fisher-Yates. La version de ordenar con `Math.random() - 0.5` es tentadora
 * y esta mal: el resultado no es uniforme y lo del principio tiende a
 * quedarse cerca del principio.
 */
function barajar(lista) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalizar(videos) {
  const lista = Array.isArray(videos) ? videos : [videos];
  return lista.filter((t) => t?.url);
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}
