'use strict';

/**
 * Favoritos y listas.
 *
 * Almacen propio, igual que el de "por donde iba" y por el mismo motivo: la
 * biblioteca se reconstruye entera con cada escaneo y es reemplazable, pero
 * una lista que alguien monto a mano no la recupera nadie. Separarlos hace
 * imposible que un fallo escaneando se la lleve por delante.
 *
 * Todo se indexa por el id del video, que es el hash de su ruta. Mover un
 * archivo de sitio cambia su id y lo saca de sus listas; a cambio, esto
 * sobrevive a reinicios y a reescaneos sin depender de nada mas.
 */

const VERSION = 1;

class Collections {
  constructor(store) {
    this.store = store;
    this.favorites = new Set(asArray(store.get('favorites', [])));
    this.playlists = asArray(store.get('playlists', []));
  }

  // --- Favoritos ------------------------------------------------------------

  isFavorite(id) {
    return this.favorites.has(id);
  }

  toggleFavorite(id) {
    if (!id) return false;
    if (this.favorites.has(id)) this.favorites.delete(id);
    else this.favorites.add(id);
    this.persist();
    return this.favorites.has(id);
  }

  favoriteIds() {
    return [...this.favorites];
  }

  // --- Listas ---------------------------------------------------------------

  /**
   * Una lista guarda ids, no rutas ni videos enteros. Guardando el video
   * completo, volver a escanear dejaria la lista ensenando los datos viejos
   * para siempre.
   */
  createPlaylist(name, trackIds = []) {
    const lista = {
      id: nuevoId(),
      name: nombreLibre(this.playlists, name),
      tracks: [...new Set(asArray(trackIds))],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.playlists.push(lista);
    this.persist();
    return lista;
  }

  renamePlaylist(id, name) {
    const lista = this.findPlaylist(id);
    if (!lista) return null;
    lista.name = nombreLibre(this.playlists.filter((p) => p.id !== id), name);
    lista.updatedAt = Date.now();
    this.persist();
    return lista;
  }

  removePlaylist(id) {
    const antes = this.playlists.length;
    this.playlists = this.playlists.filter((p) => p.id !== id);
    if (this.playlists.length !== antes) this.persist();
    return antes !== this.playlists.length;
  }

  findPlaylist(id) {
    return this.playlists.find((p) => p.id === id) ?? null;
  }

  addToPlaylist(id, trackIds) {
    const lista = this.findPlaylist(id);
    if (!lista) return null;
    // Sin filtrar repetidos, arrastrar la misma carpeta dos veces deja la
    // lista con todo duplicado y sin forma comoda de limpiarlo.
    const ya = new Set(lista.tracks);
    const nuevos = asArray(trackIds).filter((t) => t && !ya.has(t));
    lista.tracks.push(...nuevos);
    lista.updatedAt = Date.now();
    this.persist();
    return { lista, anadidos: nuevos.length, repetidos: asArray(trackIds).length - nuevos.length };
  }

  removeFromPlaylist(id, indice) {
    const lista = this.findPlaylist(id);
    if (!lista || indice < 0 || indice >= lista.tracks.length) return null;
    lista.tracks.splice(indice, 1);
    lista.updatedAt = Date.now();
    this.persist();
    return lista;
  }

  movePlaylistTrack(id, desde, hasta) {
    const lista = this.findPlaylist(id);
    if (!lista) return null;
    if (desde < 0 || desde >= lista.tracks.length) return lista;
    const destino = Math.max(0, Math.min(hasta, lista.tracks.length - 1));
    const [pieza] = lista.tracks.splice(desde, 1);
    lista.tracks.splice(destino, 0, pieza);
    lista.updatedAt = Date.now();
    this.persist();
    return lista;
  }

  // --- Serializacion --------------------------------------------------------

  all() {
    return {
      version: VERSION,
      favorites: this.favoriteIds(),
      playlists: this.playlists,
    };
  }

  /** Quita de favoritos y de las listas lo que ya no existe en el disco. */
  prune(idsVivos) {
    const vivos = idsVivos instanceof Set ? idsVivos : new Set(idsVivos);
    let cambios = 0;

    for (const id of [...this.favorites]) {
      if (!vivos.has(id)) {
        this.favorites.delete(id);
        cambios++;
      }
    }
    for (const lista of this.playlists) {
      const antes = lista.tracks.length;
      lista.tracks = lista.tracks.filter((id) => vivos.has(id));
      cambios += antes - lista.tracks.length;
    }

    if (cambios) this.persist();
    return cambios;
  }

  persist() {
    this.store.merge(this.all());
  }
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function nuevoId() {
  return require('node:crypto').randomUUID();
}

/**
 * Dos listas con el mismo nombre son indistinguibles en el lateral y una de
 * las dos se vuelve imposible de encontrar. Se numera la repetida.
 */
function nombreLibre(listas, propuesto) {
  const base = String(propuesto ?? '').trim() || 'Lista nueva';
  const usados = new Set(listas.map((p) => p.name.toLowerCase()));
  if (!usados.has(base.toLowerCase())) return base;
  for (let n = 2; n < 999; n++) {
    const intento = `${base} ${n}`;
    if (!usados.has(intento.toLowerCase())) return intento;
  }
  return `${base} ${Date.now()}`;
}

module.exports = { Collections };
