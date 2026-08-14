/**
 * Lista de videos con ventana deslizante.
 *
 * Solo se crean las filas que caben en pantalla mas un margen, y se reutilizan
 * los mismos nodos al desplazarse. Pintar la biblioteca entera es comodo hasta
 * que alguien tiene cinco mil archivos: son decenas de miles de nodos, cada uno
 * con su miniatura, la ventana tarda segundos en abrir y el scroll va a saltos.
 */

import { el, glifo, formatoTiempo, clamp } from './dom.js';

const MARGEN = 6; // filas de sobra arriba y abajo, para que no aparezcan a la vista

export const COLUMNAS = [
  { clave: 'title', etiqueta: 'Titulo' },
  { clave: 'folder', etiqueta: 'Carpeta' },
  { clave: 'duration', etiqueta: 'Duracion' },
];

export function crearLista(opciones = {}) {
  const {
    onReproducir,
    altoFila = 60,
    conCabecera = true,
    onFavorito,
    onQuitar,
    onMenu,
    onMover,
    // Modo estrecho, para el panel de la cola: sin cabecera, sin columna de
    // carpeta y con la duracion metida en la segunda linea, que es lo unico
    // que cabe en 320 pixeles de ancho.
    compacta = false,
  } = opciones;

  /**
   * Si un clic solo selecciona o ademas reproduce.
   *
   * En video viene apagado por defecto: un video ocupa la ventana entera y
   * arranca con sonido, asi que lanzarlo con un roce de raton mientras se
   * busca otra cosa molesta mucho mas que cambiar la cancion de fondo.
   */
  let unClic = opciones.unClic ?? false;

  let todas = [];
  let visibles = [];
  let idActual = null;
  let reproduciendo = false;
  let seleccion = -1;
  let orden = { por: 'title', dir: 'asc' };
  let filtro = '';
  let favoritos = new Set();
  /** { id: fraccion 0..1 } — lo que se lleva visto de cada uno. */
  let progreso = new Map();
  const pool = [];

  const filas = el('div', { class: 'lista__espacio' });
  const linea = el('div', { class: 'lista__linea', hidden: true });
  const viewport = el('div', { class: 'lista__viewport', tabindex: '0' }, [filas, linea]);
  const cabecera = conCabecera ? crearCabecera() : null;
  const conAccion = !!(onFavorito || onQuitar);
  const raiz = el('div', {
    class: `lista${conAccion ? '' : ' lista--sin-fav'}${compacta ? ' lista--compacta' : ''}`,
  }, [cabecera?.nodo, viewport]);
  raiz.style.setProperty('--alto-fila', `${altoFila}px`);

  viewport.addEventListener('scroll', pintar, { passive: true });

  // --- Reordenado (solo donde el orden lo decide el usuario) ----------------

  let arrastrando = null;
  let hueco = -1;

  function huecoEn(clientY) {
    const r = viewport.getBoundingClientRect();
    const y = clientY - r.top + viewport.scrollTop;
    // round y no floor: el destino es el hueco ENTRE filas, asi que la mitad
    // de arriba de una fila deja el video encima y la de abajo, debajo.
    return clamp(Math.round(y / altoFila), 0, visibles.length);
  }

  function finArrastre() {
    arrastrando = null;
    hueco = -1;
    linea.hidden = true;
  }

  if (onMover) {
    viewport.addEventListener('dragover', (e) => {
      if (arrastrando === null) return;
      e.preventDefault();
      // Sin frenarlo, el manejador global de archivos enciende la capa de
      // "suelta los videos aqui" mientras se reordena la lista.
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      hueco = huecoEn(e.clientY);
      linea.hidden = false;
      linea.style.setProperty('--hueco', String(hueco));
    });

    viewport.addEventListener('drop', (e) => {
      if (arrastrando === null) return;
      e.preventDefault();
      e.stopPropagation();
      // Al sacar el video de su sitio, lo que venia detras sube un puesto.
      const destino = arrastrando < hueco ? hueco - 1 : hueco;
      const origen = arrastrando;
      finArrastre();
      if (destino !== origen) onMover(origen, destino);
    });
  }

  // Un redimensionado cambia cuantas filas caben: sin esto, agrandar la
  // ventana deja media pantalla en blanco hasta que alguien toque el scroll.
  const observador = new ResizeObserver(() => pintar());
  observador.observe(viewport);

  viewport.addEventListener('keydown', (e) => {
    if (!visibles.length) return;
    if (e.key === 'ArrowDown') mover(1, e);
    else if (e.key === 'ArrowUp') mover(-1, e);
    else if (e.key === 'Home') irA(0, e);
    else if (e.key === 'End') irA(visibles.length - 1, e);
    else if (e.key === 'Enter' && seleccion >= 0) {
      e.preventDefault();
      lanzar(seleccion);
    }
  });

  function mover(delta, evento) {
    irA(clamp(seleccion + delta, 0, visibles.length - 1), evento);
  }

  function irA(indice, evento) {
    evento.preventDefault();
    seleccion = indice;
    asegurarVisible(indice);
    pintar();
  }

  function asegurarVisible(indice) {
    const arriba = indice * altoFila;
    const abajo = arriba + altoFila;
    if (arriba < viewport.scrollTop) viewport.scrollTop = arriba;
    else if (abajo > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTop = abajo - viewport.clientHeight;
    }
  }

  function lanzar(indice) {
    const track = visibles[indice];
    if (track) onReproducir?.(track, indice, visibles);
  }

  // --- Cabecera -------------------------------------------------------------

  function crearCabecera() {
    const flechas = new Map();
    const cols = COLUMNAS.map((col) => {
      const flecha = el('span', { class: 'lista__flecha' });
      flechas.set(col.clave, flecha);
      return el('button', {
        class: `lista__col lista__col--${col.clave === 'duration' ? 'fin' : col.clave}`,
        onClick: () => ordenarPor(col.clave),
      }, [el('span', { texto: col.etiqueta }), flecha]);
    });

    const nodo = el('div', { class: 'lista__cabecera' }, [
      el('div', { class: 'lista__col', texto: '#' }),
      cols[0],
      cols[1],
      // Hueco de la columna de favorito. Sin el, cada titulo de columna se
      // desplaza y deja de estar encima de lo que titula.
      el('div', { class: 'lista__col-hueco' }),
      cols[2],
    ]);

    return {
      nodo,
      pintar() {
        for (const [clave, flecha] of flechas) {
          const activa = orden.por === clave;
          flecha.textContent = activa ? glifo(orden.dir === 'asc' ? 'flechaArriba' : 'flechaAbajo') : '';
          const boton = flecha.parentElement;
          if (activa) boton.setAttribute('aria-sort', orden.dir === 'asc' ? 'ascending' : 'descending');
          else boton.removeAttribute('aria-sort');
        }
      },
    };
  }

  function ordenarPor(clave) {
    if (orden.por === clave) orden.dir = orden.dir === 'asc' ? 'desc' : 'asc';
    else orden = { por: clave, dir: 'asc' };
    aplicar();
    opciones.onOrden?.({ ...orden });
  }

  // --- Datos ----------------------------------------------------------------

  function aplicar() {
    const texto = filtro.trim().toLowerCase();
    visibles = texto
      ? todas.filter((t) => coincide(t, texto))
      : [...todas];

    // 'ninguno' respeta el orden con el que llegan. Lo usan las vistas donde
    // el orden ES la informacion, como lo visto hace poco: reordenarlo
    // alfabeticamente lo convertiria en otra lista cualquiera.
    if (orden.por !== 'ninguno') {
      const signo = orden.dir === 'asc' ? 1 : -1;
      visibles.sort((a, b) => signo * comparar(a, b, orden.por));
    }

    seleccion = -1;
    viewport.scrollTop = 0;
    filas.style.setProperty('--filas', String(visibles.length));
    cabecera?.pintar();
    pintar();
    opciones.onFiltrado?.(visibles);
  }

  // --- Pintado --------------------------------------------------------------

  function pintar() {
    const alto = viewport.clientHeight || 0;
    const desde = Math.max(0, Math.floor(viewport.scrollTop / altoFila) - MARGEN);
    const hasta = Math.min(visibles.length, Math.ceil((viewport.scrollTop + alto) / altoFila) + MARGEN);
    const cuantas = Math.max(0, hasta - desde);

    while (pool.length < cuantas) {
      const fila = crearFila();
      pool.push(fila);
      filas.append(fila.nodo);
    }
    for (let i = cuantas; i < pool.length; i++) pool[i].nodo.hidden = true;

    for (let i = 0; i < cuantas; i++) {
      const indice = desde + i;
      pool[i].nodo.hidden = false;
      pool[i].pintar(visibles[indice], indice);
    }
  }

  function crearFila() {
    const numero = el('span', { class: 'fila__num-texto tabular' });
    const play = el('span', { class: 'fila__num-play', texto: glifo('reproducir') });
    const ondas = el('div', { class: 'fila__ondas' }, [
      el('span'), el('span'), el('span'),
    ]);
    const imagen = el('img', { alt: '' });
    // La barrita de "por donde iba" vive dentro de la miniatura, como en
    // cualquier reproductor: es donde se busca sin tener que leer nada.
    const vistoHasta = el('div', { class: 'fila__visto' });
    const arte = el('div', { class: 'fila__arte' }, [imagen, vistoHasta]);
    const titulo = el('div', { class: 'fila__titulo truncar' });
    const detalle = el('div', { class: 'fila__detalle truncar' });
    const carpeta = el('div', { class: 'fila__carpeta truncar' });
    const duracion = el('div', { class: 'fila__duracion tabular' });
    // Un solo hueco para la accion de la derecha. En la biblioteca es el
    // corazon; en la cola, quitar de la cola. Nunca hacen falta los dos.
    const accion = onQuitar
      ? el('button', { class: 'fila__fav fila__quitar', texto: glifo('quitar'), title: 'Quitar de la cola' })
      : onFavorito
        ? el('button', { class: 'fila__fav' })
        : el('div', { class: 'fila__fav-hueco' });

    const nodo = el('div', { class: 'fila', role: 'row' }, [
      el('div', { class: 'fila__num' }, [numero, play, ondas]),
      el('div', { class: 'fila__principal' }, [
        arte,
        el('div', { class: 'fila__textos' }, [titulo, detalle]),
      ]),
      carpeta,
      accion,
      duracion,
    ]);

    let indiceActual = -1;

    if (onFavorito || onQuitar) {
      accion.addEventListener('click', (e) => {
        // Sin frenarlo, pulsar la accion selecciona ademas la fila.
        e.stopPropagation();
        if (onQuitar) onQuitar(visibles[indiceActual], indiceActual);
        else onFavorito(visibles[indiceActual]);
      });
    }

    nodo.addEventListener('click', () => {
      seleccion = indiceActual;
      pintar();
      // Con `unClic` puesto, el clic ya reproduce. El doble clic sigue atado
      // igualmente: si no lo estuviera, quien tenga la costumbre de dar dos
      // veces lanzaria el video, lo reiniciaria en el acto, y pareceria que
      // se ha trabado.
      if (unClic) lanzar(indiceActual);
    });
    nodo.addEventListener('dblclick', () => lanzar(indiceActual));

    if (onMenu) {
      nodo.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        seleccion = indiceActual;
        pintar();
        onMenu(visibles[indiceActual], indiceActual, e);
      });
    }

    if (onMover) {
      nodo.draggable = true;
      nodo.addEventListener('dragstart', (e) => {
        arrastrando = indiceActual;
        e.dataTransfer.effectAllowed = 'move';
        // Chromium no arranca el arrastre si no se le dan datos.
        e.dataTransfer.setData('text/plain', String(indiceActual));
      });
      nodo.addEventListener('dragend', finArrastre);
    }

    return {
      nodo,
      pintar(track, indice) {
        indiceActual = indice;
        nodo.style.setProperty('--i', String(indice));
        if (!track) return;

        numero.textContent = String(indice + 1);
        titulo.textContent = track.title;
        detalle.textContent = subtitulo(track, compacta);
        carpeta.textContent = track.folder ?? '';
        duracion.textContent = track.duration ? formatoTiempo(track.duration) : '—';
        nodo.title = track.fileName ?? track.title;

        if (track.thumbUrl) {
          if (imagen.getAttribute('src') !== track.thumbUrl) imagen.src = track.thumbUrl;
          imagen.hidden = false;
          arte.dataset.conArte = 'true';
        } else {
          imagen.removeAttribute('src');
          imagen.hidden = true;
          delete arte.dataset.conArte;
        }

        const visto = progreso.get(track.id) ?? 0;
        vistoHasta.hidden = visto <= 0;
        vistoHasta.style.setProperty('--visto', String(visto));

        if (onFavorito && !onQuitar) {
          const esFav = favoritos.has(track.id);
          accion.textContent = glifo(esFav ? 'corazonLleno' : 'corazon');
          accion.dataset.marcado = String(esFav);
          const etiqueta = esFav ? 'Quitar de favoritos' : 'Anadir a favoritos';
          accion.title = etiqueta;
          accion.setAttribute('aria-label', `${etiqueta}: ${track.title}`);
        } else if (onQuitar) {
          accion.setAttribute('aria-label', `Quitar ${track.title} de la cola`);
        }

        nodo.dataset.id = track.id;
        nodo.dataset.activa = String(track.id === idActual);
        nodo.dataset.sonando = String(reproduciendo);
        nodo.dataset.seleccionada = String(indice === seleccion);
      },
    };
  }

  // --- API ------------------------------------------------------------------

  return {
    nodo: raiz,

    setVideos(lista) {
      todas = lista ?? [];
      aplicar();
    },

    setFiltro(texto) {
      filtro = texto ?? '';
      aplicar();
    },

    /** No hace falta repintar: los oyentes leen la bandera al dispararse. */
    setUnClic(valor) {
      unClic = !!valor;
    },

    setOrden(por, dir) {
      orden = { por: por ?? orden.por, dir: dir ?? orden.dir };
      aplicar();
    },

    setActual(id, estaReproduciendo) {
      idActual = id ?? null;
      reproduciendo = !!estaReproduciendo;
      pintar();
    },

    setFavoritos(ids) {
      favoritos = ids instanceof Set ? ids : new Set(ids ?? []);
      pintar();
    },

    /**
     * Cambia UN video en el sitio, sin rehacer la lista.
     *
     * Lo usa el sondeo, que va soltando duraciones y miniaturas de una en
     * una. Pasar por setVideos en cada una volveria a ordenar y a filtrar
     * todo, y —lo que se nota de verdad— devolveria el desplazamiento al
     * principio y perderia la seleccion: la lista daria un salto por cada
     * miniatura que aparece.
     */
    actualizar(video) {
      if (!video?.id) return false;
      let tocado = false;
      for (const grupo of [todas, visibles]) {
        const i = grupo.findIndex((v) => v.id === video.id);
        if (i >= 0) {
          grupo[i] = video;
          tocado = true;
        }
      }
      if (tocado) pintar();
      return tocado;
    },

    setProgreso(mapa) {
      progreso = mapa instanceof Map ? mapa : new Map(Object.entries(mapa ?? {}));
      pintar();
    },

    get visibles() { return visibles; },

    get orden() { return { ...orden }; },

    destruir() {
      observador.disconnect();
    },
  };
}

/**
 * La segunda linea de la fila.
 *
 * Lleva lo que distingue un archivo de otro con el mismo titulo: el episodio,
 * el ano y la calidad. Es exactamente la informacion que se busca cuando en la
 * carpeta hay dos copias de la misma pelicula.
 */
function subtitulo(track, conDuracion = false) {
  const partes = [];
  // En el modo estrecho no hay columna de duracion, asi que se cuela aqui:
  // es el dato que mas se mira de una cola.
  if (conDuracion && track.duration) partes.push(formatoTiempo(track.duration));
  if (track.season || track.episode) {
    const s = String(track.season ?? 1).padStart(2, '0');
    const e = String(track.episode ?? 1).padStart(2, '0');
    partes.push(`S${s}E${e}`);
  }
  if (track.year) partes.push(String(track.year));
  if (track.height) partes.push(`${track.height}p`);
  const extra = etiquetasUtiles(track).slice(0, 2);
  if (extra.length) partes.push(extra.join(' · '));
  return partes.join(' · ') || track.fileName || '';
}

/** Lo que el nombre del archivo dice sobre la resolucion. */
const ETIQUETA_RESOLUCION = /^(\d{3,4}[pi]|4K|8K|UHD|FHD|HD|SD)$/i;

/**
 * Las etiquetas que aportan algo, una vez sondeado el archivo.
 *
 * En cuanto se conoce la resolucion de verdad, la que venia en el nombre
 * sobra — y ademas miente a menudo: un archivo llamado "1080p" que resulta
 * ser 720p acababa ensenando "720p · 1080P" en la misma linea, que es
 * justo la clase de detalle que hace dudar de todo lo demas.
 */
function etiquetasUtiles(track) {
  const etiquetas = track.etiquetas ?? [];
  if (!track.height) return etiquetas;
  return etiquetas.filter((e) => !ETIQUETA_RESOLUCION.test(e));
}

function coincide(track, texto) {
  return (
    track.title.toLowerCase().includes(texto) ||
    (track.folder ?? '').toLowerCase().includes(texto) ||
    (track.fileName ?? '').toLowerCase().includes(texto)
  );
}

/**
 * Comparacion con desempate.
 *
 * Dentro de una misma carpeta manda el numero de episodio: ordenar una serie
 * alfabeticamente por el nombre del capitulo la deja en un revoltijo donde el
 * 10 va antes que el 2.
 */
function comparar(a, b, por) {
  if (por === 'duration') return (a.duration || 0) - (b.duration || 0);
  if (por === 'addedAt') return (a.addedAt || 0) - (b.addedAt || 0);
  if (por === 'size') return (a.size || 0) - (b.size || 0);

  if (por === 'folder') {
    const carpeta = texto(a.folder).localeCompare(texto(b.folder), 'es');
    if (carpeta) return carpeta;
    const orden = porEpisodio(a, b);
    if (orden) return orden;
  }

  const orden = porEpisodio(a, b);
  if (orden && texto(a.title) === texto(b.title)) return orden;

  return texto(a.title).localeCompare(texto(b.title), 'es', { numeric: true });
}

function porEpisodio(a, b) {
  const temporada = (a.season || 0) - (b.season || 0);
  if (temporada) return temporada;
  return (a.episode || 0) - (b.episode || 0);
}

function texto(v) {
  return String(v ?? '');
}
