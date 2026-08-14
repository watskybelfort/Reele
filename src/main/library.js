'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const { VIDEO_EXTENSIONS } = require('./defaults');
const { analizar } = require('./nombres');
const protocols = require('./protocols');

const EXTS = new Set(VIDEO_EXTENSIONS);
const LIBRARY_VERSION = 1;

/**
 * Biblioteca de video.
 *
 * La diferencia grande con la de Sounde: aqui el escaneo NO abre los
 * archivos. Un mp3 se lee de cabecera en milisegundos, pero para saber
 * cuanto dura un mkv hay que demultiplexarlo, y no hay forma de hacerlo en
 * el proceso principal sin arrastrar ffmpeg entero.
 *
 * Asi que el escaneo se queda en lo que da el sistema de archivos —que es
 * instantaneo incluso con miles de videos— y la duracion, el tamano de
 * imagen y el fotograma de portada los rellena despues el renderer, que
 * tiene un decodificador de video dentro. Ese es el trabajo de `enriquecer`.
 *
 * El efecto practico: la biblioteca aparece entera en cuanto se anade la
 * carpeta, y las miniaturas van cayendo. La alternativa —esperar a tenerlo
 * todo— serian minutos de pantalla vacia.
 */
class Library {
  constructor(store) {
    this.store = store;
    this.tracks = new Map();
    this.scanning = false;
    this._cancel = false;

    const guardado = store.get('tracks', []);
    if (Array.isArray(guardado)) {
      for (const t of guardado) this.tracks.set(t.id, t);
    }
  }

  all() {
    return [...this.tracks.values()];
  }

  get(id) {
    return this.tracks.get(id) ?? null;
  }

  byPath(file) {
    return this.tracks.get(idDe(file)) ?? null;
  }

  size() {
    return this.tracks.size;
  }

  /** Los que aun no han pasado por el sondeo del renderer. */
  pendientes() {
    return this.all().filter((t) => !t.sondeado);
  }

  persist() {
    this.store.merge({ version: LIBRARY_VERSION, tracks: this.all() });
    this.store.save();
  }

  cancel() {
    this._cancel = true;
  }

  /**
   * Escaneo incremental.
   *
   * Solo se vuelven a mirar los archivos cuyo mtime o tamano cambiaron. Los
   * demas conservan lo que ya se sabia de ellos, incluida la miniatura: sin
   * esto, cada arranque tiraria todas las portadas y habria que volver a
   * decodificar la biblioteca entera.
   */
  async scan(folders, onProgress = () => {}) {
    if (this.scanning) return { ok: false, reason: 'ya-escaneando' };
    this.scanning = true;
    this._cancel = false;

    const t0 = Date.now();
    try {
      onProgress({ phase: 'walk', done: 0, total: 0 });

      const encontrados = [];
      for (const carpeta of folders) {
        if (this._cancel) break;
        protocols.allowRoot(carpeta);
        await walk(carpeta, encontrados, () => this._cancel, (n) => {
          onProgress({ phase: 'walk', done: n, total: 0 });
        });
      }

      if (this._cancel) return { ok: false, reason: 'cancelado' };

      const vistos = new Set();
      let nuevos = 0;

      for (const { file, stat } of encontrados) {
        const id = idDe(file);
        vistos.add(id);
        const previo = this.tracks.get(id);
        if (previo && previo.mtimeMs === stat.mtimeMs && previo.size === stat.size) continue;
        this.tracks.set(id, describir({ id, file, stat, previo }));
        nuevos++;
      }

      // Lo que ya no esta en disco sale de la biblioteca, o la lista se
      // llena de entradas fantasma que al pulsarlas dan error.
      let eliminados = 0;
      for (const id of [...this.tracks.keys()]) {
        if (!vistos.has(id)) {
          this.tracks.delete(id);
          eliminados++;
        }
      }

      this.persist();

      return {
        ok: true,
        cancelado: this._cancel,
        nuevos,
        eliminados,
        total: this.tracks.size,
        ms: Date.now() - t0,
      };
    } finally {
      this.scanning = false;
    }
  }

  /** Anade archivos sueltos (Abrir con..., arrastrar y soltar). */
  async addFiles(files) {
    const salida = [];
    for (const file of files) {
      if (!EXTS.has(path.extname(file).toLowerCase())) continue;
      protocols.allowFile(file);
      const id = idDe(file);
      const previo = this.tracks.get(id);
      let stat;
      try {
        stat = await fsp.stat(file);
      } catch {
        continue;
      }
      if (previo && previo.mtimeMs === stat.mtimeMs && previo.size === stat.size) {
        salida.push(previo);
        continue;
      }
      const track = describir({ id, file, stat, previo });
      this.tracks.set(id, track);
      salida.push(track);
    }
    if (salida.length) this.persist();
    return salida;
  }

  /**
   * Guarda lo que el renderer averiguo abriendo el video.
   *
   * `sondeado` se marca aunque el sondeo haya fallado. Sin eso, un archivo
   * que Chromium no sabe decodificar volveria a intentarse en cada arranque
   * y en cada refresco de la lista, para siempre.
   */
  enriquecer(id, datos = {}) {
    const track = this.tracks.get(id);
    if (!track) return null;

    if (Number.isFinite(datos.duration) && datos.duration > 0) track.duration = datos.duration;
    if (Number.isFinite(datos.width) && datos.width > 0) track.width = datos.width;
    if (Number.isFinite(datos.height) && datos.height > 0) track.height = datos.height;
    if (datos.thumb) track.thumb = datos.thumb;
    if (Array.isArray(datos.colores) && datos.colores.length) track.colores = datos.colores;
    track.sondeado = true;

    this.store.merge({ version: LIBRARY_VERSION, tracks: this.all() });
    return track;
  }

  /** Vuelve a poner en cola de sondeo lo que no llego a tener miniatura. */
  olvidarSondeo(ids) {
    const lista = Array.isArray(ids) ? ids : [...this.tracks.keys()];
    let tocados = 0;
    for (const id of lista) {
      const track = this.tracks.get(id);
      if (!track) continue;
      track.sondeado = false;
      tocados++;
    }
    if (tocados) this.persist();
    return tocados;
  }
}

// --- Descripcion de un video ----------------------------------------------

/**
 * Lo que se sabe de un archivo sin abrirlo.
 *
 * Se conserva lo que ya se hubiera averiguado antes (`previo`) cuando el
 * archivo no ha cambiado de contenido: si solo se renombro, el titulo se
 * recalcula pero la miniatura y la duracion siguen valiendo.
 */
function describir({ id, file, stat, previo }) {
  const nombre = path.basename(file);
  const base = path.basename(file, path.extname(file));
  const { title, year, season, episode, etiquetas } = analizar(base);
  const mismoContenido = previo && previo.size === stat.size;

  return {
    id,
    path: file,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    addedAt: previo?.addedAt ?? Date.now(),

    title,
    fileName: nombre,
    folder: path.basename(path.dirname(file)),
    year,
    season,
    episode,
    etiquetas,
    codec: path.extname(file).slice(1).toUpperCase(),

    // Lo que solo sabe el renderer, tras abrir el archivo.
    duration: mismoContenido ? previo.duration ?? 0 : 0,
    width: mismoContenido ? previo.width ?? null : null,
    height: mismoContenido ? previo.height ?? null : null,
    thumb: mismoContenido ? previo.thumb ?? null : null,
    colores: mismoContenido ? previo.colores ?? null : null,
    sondeado: mismoContenido ? !!previo.sondeado : false,
  };
}

// --- Recorrido del disco --------------------------------------------------

/** Carpetas que nunca contienen video y si mucho ruido. */
const IGNORAR = new Set([
  'node_modules', '.git', '$recycle.bin', 'system volume information',
  'windows', 'appdata', '.cache', 'program files', 'program files (x86)',
]);

async function walk(dir, salida, cancelado, tick) {
  if (cancelado()) return;

  let entradas;
  try {
    entradas = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return; // sin permiso o desconectada: se ignora en silencio
  }

  for (const entrada of entradas) {
    if (cancelado()) return;
    const completo = path.join(dir, entrada.name);

    if (entrada.isDirectory()) {
      if (IGNORAR.has(entrada.name.toLowerCase())) continue;
      if (entrada.name.startsWith('.')) continue;
      await walk(completo, salida, cancelado, tick);
      continue;
    }

    if (!entrada.isFile()) continue;
    if (!EXTS.has(path.extname(entrada.name).toLowerCase())) continue;

    try {
      const stat = await fsp.stat(completo);
      salida.push({ file: completo, stat });
      if (salida.length % 25 === 0) tick(salida.length);
    } catch { /* desaparecio entre readdir y stat */ }
  }
}

// --- Utilidades -----------------------------------------------------------

/** Id estable: la ruta define el video, asi sobrevive a reinicios. */
function idDe(file) {
  return crypto.createHash('sha1').update(path.resolve(file).toLowerCase()).digest('hex').slice(0, 16);
}

module.exports = { Library, idDe };
