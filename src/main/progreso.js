'use strict';

/**
 * Por donde iba cada video.
 *
 * Almacen aparte del de la biblioteca a proposito: la biblioteca se
 * reconstruye entera con cada escaneo y es reemplazable, pero esto no lo
 * puede recuperar el usuario de ninguna manera. Separarlos hace imposible
 * que un fallo escaneando se lleve por delante las tres peliculas que tenia
 * a medias.
 *
 * Se indexa por el id del video, que es el hash de su ruta. Mover un archivo
 * de sitio le hace perder su marca; a cambio esto sobrevive a reinicios y a
 * reescaneos sin depender de nada mas.
 */

const VERSION = 1;

/** Cuantas entradas se guardan. De sobra para "seguir viendo". */
const MAX = 400;

class Progreso {
  constructor(store, ajustes) {
    this.store = store;
    this.ajustes = ajustes;
    this.mapa = new Map(Object.entries(store.get('videos', {}) || {}));
  }

  /**
   * Guarda por donde va.
   *
   * Los dos margenes son lo que separa una funcion util de una molesta:
   *
   *   - Por debajo del minimo no hay nada que reanudar. Ofrecer volver al
   *     segundo quince es mas incomodo que empezar de cero.
   *   - Cerca del final se considera visto y se borra la marca. Sin esto,
   *     volver a abrir algo que terminaste te deja en los creditos, que es
   *     exactamente donde no quieres estar.
   */
  guardar(id, segundos, duracion) {
    if (!id) return null;
    const t = Number(segundos) || 0;
    const dur = Number(duracion) || 0;
    const minimo = this.ajustes.get('resumeMinSeconds', 60);
    const margen = this.ajustes.get('resumeEndMargin', 90);

    if (dur > 0 && t >= dur - margen) return this.marcarVisto(id, dur);
    if (t < minimo) {
      // Volver al principio a proposito tambien cuenta: si tenia marca, se
      // quita, o al siguiente arranque volveria a saltar adonde estaba.
      if (this.mapa.has(id)) {
        this.mapa.delete(id);
        this.persist();
      }
      return null;
    }

    const previo = this.mapa.get(id);
    const entrada = {
      t,
      dur: dur || previo?.dur || 0,
      at: Date.now(),
      visto: false,
    };
    this.mapa.set(id, entrada);
    this.podarSiSobra();
    this.persist();
    return entrada;
  }

  marcarVisto(id, duracion) {
    if (!id) return null;
    const entrada = {
      t: 0,
      dur: Number(duracion) || this.mapa.get(id)?.dur || 0,
      at: Date.now(),
      visto: true,
    };
    this.mapa.set(id, entrada);
    this.podarSiSobra();
    this.persist();
    return entrada;
  }

  de(id) {
    return this.mapa.get(id) ?? null;
  }

  olvidar(id) {
    const habia = this.mapa.delete(id);
    if (habia) this.persist();
    return habia;
  }

  /**
   * Lo que se puede seguir viendo, de lo mas reciente a lo mas antiguo.
   *
   * Deja fuera lo ya visto: "seguir viendo" con la pelicula que terminaste
   * anoche dentro no es una lista de tareas pendientes, es ruido.
   */
  seguirViendo(limite = 100) {
    return [...this.mapa.entries()]
      .filter(([, v]) => !v.visto && v.t > 0)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, limite)
      .map(([id]) => id);
  }

  /** Ids vistos alguna vez, de lo mas reciente a lo mas antiguo. */
  recientes(limite = 200) {
    return [...this.mapa.entries()]
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, limite)
      .map(([id]) => id);
  }

  /**
   * La fraccion vista de cada uno, para la barrita de las miniaturas.
   *
   * Lo terminado va a 1 aunque su posicion sea 0: la barra llena es como se
   * lee "esto ya lo viste" de un vistazo.
   */
  fracciones() {
    const salida = {};
    for (const [id, v] of this.mapa) {
      if (v.visto) salida[id] = 1;
      else if (v.dur > 0 && v.t > 0) salida[id] = Math.min(1, v.t / v.dur);
    }
    return salida;
  }

  /** Quita lo que ya no existe en la biblioteca. */
  podar(idsVivos) {
    const vivos = idsVivos instanceof Set ? idsVivos : new Set(idsVivos);
    let fuera = 0;
    for (const id of [...this.mapa.keys()]) {
      if (!vivos.has(id)) {
        this.mapa.delete(id);
        fuera++;
      }
    }
    if (fuera) this.persist();
    return fuera;
  }

  podarSiSobra() {
    if (this.mapa.size <= MAX) return;
    const orden = [...this.mapa.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [id] of orden.slice(0, this.mapa.size - MAX)) this.mapa.delete(id);
  }

  all() {
    return { version: VERSION, videos: Object.fromEntries(this.mapa) };
  }

  persist() {
    this.store.merge(this.all());
  }
}

module.exports = { Progreso };
