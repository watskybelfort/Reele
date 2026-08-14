'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const protocols = require('./protocols');

/**
 * Cache de fotogramas de portada.
 *
 * Los extrae el renderer, que es quien tiene un decodificador de video
 * dentro; aqui solo se guardan en disco y se les pone nombre.
 *
 * El nombre es el hash del contenido, no el del video. Dos capitulos que
 * empiezan con la misma cabecera de serie dan el mismo fotograma y comparten
 * un unico archivo en vez de escribir veinte copias identicas.
 */

let secuencia = 0;

async function guardar(bytes) {
  if (!bytes?.byteLength) return null;
  const dir = protocols.getThumbDir();
  if (!dir) return null;

  const buffer = Buffer.from(bytes);
  const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 20);
  const nombre = `${hash}.jpg`;
  const destino = path.join(dir, nombre);

  try {
    await fsp.access(destino);
    return nombre; // ya estaba
  } catch { /* hay que escribirlo */ }

  // El temporal lleva sufijo unico. Con un nombre fijo, dos videos que
  // comparten fotograma y se sondean seguidos escriben el mismo .tmp: el
  // primero en renombrar se lo lleva y el otro falla con ENOENT.
  const tmp = `${destino}.${process.pid}.${secuencia++}.tmp`;
  try {
    await fsp.writeFile(tmp, buffer);
    await fsp.rename(tmp, destino);
    return nombre;
  } catch (err) {
    // Si el otro gano la carrera, el archivo final ya existe y vale.
    try {
      await fsp.access(destino);
      return nombre;
    } catch { /* de verdad fallo */ }
    console.warn('[miniaturas] no pude guardar:', err.message);
    return null;
  } finally {
    try { await fsp.unlink(tmp); } catch { /* ya no estaba, que es lo normal */ }
  }
}

/**
 * Borra los fotogramas que ya no usa nadie.
 *
 * Sin esto la cache solo crece: quitar una carpeta de la biblioteca saca los
 * videos de la lista pero deja sus miniaturas ahi para siempre, y con
 * bibliotecas grandes eso son cientos de megas invisibles en AppData.
 */
async function limpiar(vivos) {
  const dir = protocols.getThumbDir();
  if (!dir) return 0;
  const referenciados = new Set(vivos);

  let entradas;
  try {
    entradas = await fsp.readdir(dir);
  } catch {
    return 0;
  }

  let borrados = 0;
  for (const nombre of entradas) {
    // Los temporales de una ejecucion que se corto a medias tambien sobran.
    const huerfano = !referenciados.has(nombre) || nombre.endsWith('.tmp');
    if (!huerfano) continue;
    try {
      await fsp.unlink(path.join(dir, nombre));
      borrados++;
    } catch { /* alguien lo abrio justo ahora: ya caera la proxima vez */ }
  }
  return borrados;
}

/** Solo para pruebas: cuantos archivos hay en la cache. */
function cuantas() {
  const dir = protocols.getThumbDir();
  try {
    return dir ? fs.readdirSync(dir).length : 0;
  } catch {
    return 0;
  }
}

module.exports = { guardar, limpiar, cuantas };
