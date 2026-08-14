/**
 * Favoritos y listas, del lado de la pagina.
 *
 * Guarda una copia en memoria de lo que hay en el proceso principal y la
 * mantiene al dia con sus avisos. Es lo que permite que la lista pinte el
 * corazon de cinco mil filas sin un IPC por fila.
 */

import { crearEmisor } from './emitter.js';

export async function crearColecciones() {
  const emisor = crearEmisor();

  let favoritos = new Set(await window.reele.favoritos.todos());
  let listas = await window.reele.listas.todas();

  window.reele.favoritos.onCambio(({ favorites }) => {
    favoritos = new Set(favorites);
    emisor.emit('favoritos', favoritos);
  });

  window.reele.listas.onCambio(({ playlists }) => {
    listas = playlists;
    emisor.emit('listas', listas);
  });

  return {
    on: emisor.on,

    // --- Favoritos ----------------------------------------------------------
    get favoritos() { return favoritos; },

    tiene(id) {
      return !!id && favoritos.has(id);
    },

    async alternar(id) {
      if (!id) return false;
      // Se pinta antes de que conteste el proceso principal: el corazon tiene
      // que responder al dedo, no al ida y vuelta del IPC.
      if (favoritos.has(id)) favoritos.delete(id);
      else favoritos.add(id);
      emisor.emit('favoritos', favoritos);
      return window.reele.favoritos.alternar(id);
    },

    // --- Listas -------------------------------------------------------------
    get listas() { return listas; },

    lista(id) {
      return listas.find((l) => l.id === id) ?? null;
    },

    crear: (nombre, ids) => window.reele.listas.crear(nombre, ids),
    renombrar: (id, nombre) => window.reele.listas.renombrar(id, nombre),
    quitar: (id) => window.reele.listas.quitar(id),
    anadir: (id, ids) => window.reele.listas.anadir(id, [ids].flat()),
    quitarEn: (id, indice) => window.reele.listas.quitarEn(id, indice),
    mover: (id, desde, hasta) => window.reele.listas.mover(id, desde, hasta),
  };
}
