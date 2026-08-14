/**
 * La biblioteca en pantalla: lateral, vistas, busqueda y carpetas.
 *
 * Guarda UNA copia de los videos y la reparte. Cada vista es un filtro sobre
 * esa copia, no otra consulta al proceso principal: con la biblioteca ya en
 * memoria, cambiar de vista tiene que ser instantaneo, y pedirla otra vez por
 * IPC en cada clic se nota como un parpadeo.
 */

import { $, el, glifo, pintarGlifo, plural, formatoLargo } from './dom.js';
import { crearLista } from './lista.js';

export function initShell(motor, ajustes) {
  const raiz = document.documentElement;
  const cuerpo = $('#vista-cuerpo');
  const titulo = $('#vista-titulo');
  const resumen = $('#vista-resumen');
  const buscador = $('#buscador');
  const escaneo = $('#escaneo');
  const escaneoTexto = $('#escaneo-texto');
  const cuentaVideos = $('#cuenta-videos');
  const listaCarpetas = $('#lista-carpetas');

  let videos = [];
  let carpetas = [];
  let vista = { tipo: 'videos' };
  const alCambiarVista = new Set();

  pintarGlifo($('#icono-videos'), 'video');
  pintarGlifo($('#icono-anadir'), 'anadir');
  pintarGlifo($('#icono-abrir'), 'abrir');
  pintarGlifo($('#icono-buscar'), 'buscar');
  pintarGlifo($('#btn-reescanear'), 'refrescar');
  pintarGlifo($('#btn-ver-todo'), 'reproducir');
  pintarGlifo($('#btn-ver-aleatorio'), 'aleatorio');

  // --- La lista -------------------------------------------------------------

  const lista = crearLista({
    unClic: ajustes.clickToPlay,
    onReproducir: (video, indice, enPantalla) => {
      // El escenario se abre solo al cambiar de video: lo escucha el propio
      // escenario. Repetirlo aqui seria una segunda fuente de la verdad para
      // lo mismo, y en cuanto una de las dos se olvide de un camino nuevo, el
      // video empieza a sonar con la biblioteca todavia en pantalla.
      motor.queue.setContext(enPantalla, { startIndex: indice });
    },
    onOrden: ({ por, dir }) => window.reele.settings.set({ sortBy: por, sortDir: dir }),
    onFiltrado: () => pintarResumen(),
  });
  lista.setOrden(ajustes.sortBy, ajustes.sortDir);

  cuerpo.dataset.modo = 'lista';
  cuerpo.append(
    lista.nodo,
    vacio('busqueda', 'buscar', 'Sin resultados', 'Prueba con otra cosa: se busca por titulo, por nombre de archivo y por carpeta.'),
    vacio('vista', 'video', 'Aqui todavia no hay nada', 'Anade una carpeta con tus videos o suelta archivos en la ventana.'),
  );

  // --- Cabecera -------------------------------------------------------------

  function pintarResumen() {
    const enPantalla = lista.visibles;
    titulo.textContent = vista.tipo === 'carpeta' ? vista.nombre : 'Videos';

    if (!enPantalla.length) {
      resumen.textContent = videos.length ? 'Nada que encaje con la busqueda' : 'Sin videos todavia';
    } else {
      // La duracion total solo se ensena cuando se conoce entera. Sumar solo
      // lo ya sondeado dice "2 h" en una biblioteca de veinte horas, que es
      // peor que no decir nada.
      const sondeados = enPantalla.filter((v) => v.duration > 0);
      const total = sondeados.reduce((s, v) => s + v.duration, 0);
      const partes = [plural(enPantalla.length, 'video', 'videos')];
      if (sondeados.length === enPantalla.length && total > 0) partes.push(formatoLargo(total));
      resumen.textContent = partes.join(' · ');
    }

    cuerpo.dataset.vacio = String(!enPantalla.length);
    cuerpo.dataset.fuenteVacia = String(!fuente().length);
  }

  // --- Vistas ---------------------------------------------------------------

  /** Los videos de la vista actual, antes de aplicar la busqueda. */
  function fuente() {
    if (vista.tipo === 'carpeta') {
      const raizCarpeta = vista.ruta.toLowerCase();
      return videos.filter((v) => v.path.toLowerCase().startsWith(raizCarpeta));
    }
    return videos;
  }

  function setVista(nueva) {
    vista = nueva;
    lista.setVideos(fuente());
    pintarNavegacion();
    for (const fn of alCambiarVista) fn(vista);
    // La vista solo se guarda cuando es una de las fijas: apuntar una carpeta
    // que manana ya no este dejaria la app abriendo en una lista vacia sin
    // explicacion.
    if (vista.tipo === 'videos') window.reele.settings.set({ view: vista.tipo });
  }

  function pintarNavegacion() {
    $('#nav-videos').setAttribute('aria-current', String(vista.tipo === 'videos'));
    for (const nodo of listaCarpetas.querySelectorAll('.carpeta')) {
      nodo.dataset.activa = String(vista.tipo === 'carpeta' && nodo.dataset.ruta === vista.ruta);
    }
  }

  $('#nav-videos').addEventListener('click', () => setVista({ tipo: 'videos' }));

  // --- Carpetas -------------------------------------------------------------

  function pintarCarpetas() {
    listaCarpetas.replaceChildren(...carpetas.map((ruta) => {
      const nombre = ruta.split(/[\\/]/).filter(Boolean).pop() || ruta;
      const quitar = el('button', {
        class: 'carpeta__quitar',
        texto: glifo('quitar'),
        title: 'Quitar esta carpeta de la biblioteca',
        'aria-label': `Quitar ${nombre}`,
        onClick: async (e) => {
          e.stopPropagation();
          await window.reele.library.removeFolder(ruta);
          // Quitar la carpeta que se estaba mirando deja la vista apuntando
          // a la nada: se vuelve a la general.
          if (vista.tipo === 'carpeta' && vista.ruta === ruta) vista = { tipo: 'videos' };
          await refrescar();
        },
      });

      return el('div', {
        class: 'carpeta',
        title: ruta,
        dataset: { ruta },
        onClick: () => setVista({ tipo: 'carpeta', ruta, nombre }),
      }, [
        el('span', { class: 'carpeta__icono', texto: glifo('carpeta') }),
        el('span', { class: 'carpeta__nombre', texto: nombre }),
        quitar,
      ]);
    }));
    pintarNavegacion();
  }

  $('#btn-anadir-carpeta').addEventListener('click', async () => {
    await window.reele.library.addFolder();
    await refrescar();
  });

  $('#btn-reescanear').addEventListener('click', async () => {
    await window.reele.library.scan();
    await refrescar();
  });

  // --- Busqueda -------------------------------------------------------------

  buscador.addEventListener('input', () => lista.setFiltro(buscador.value));

  buscador.addEventListener('keydown', (e) => {
    // Escape limpia; si ya esta limpio, suelta el foco. Sin lo segundo, el
    // campo se queda con el cursor puesto y las teclas de reproduccion (que
    // son letras) se escriben en la busqueda en vez de mandar sobre el video.
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (buscador.value) {
      buscador.value = '';
      lista.setFiltro('');
    } else {
      buscador.blur();
    }
  });

  // --- Reproducir la vista entera -------------------------------------------

  $('#btn-ver-todo').addEventListener('click', () => {
    if (!lista.visibles.length) return;
    motor.queue.setShuffle(false);
    motor.queue.setContext(lista.visibles, { startIndex: 0 });
  });

  $('#btn-ver-aleatorio').addEventListener('click', () => {
    if (!lista.visibles.length) return;
    motor.queue.setShuffle(true);
    motor.queue.setContext(lista.visibles, { startIndex: Math.floor(Math.random() * lista.visibles.length) });
  });

  // --- Plegar el lateral ----------------------------------------------------

  const btnPlegar = $('#btn-plegar');

  function pintarPlegado() {
    const plegado = raiz.dataset.lateral === 'plegado';
    pintarGlifo($('#icono-plegar'), plegado ? 'desplegar' : 'plegar');
    const etiqueta = plegado ? 'Desplegar el panel' : 'Plegar el panel';
    btnPlegar.title = etiqueta;
    btnPlegar.setAttribute('aria-label', etiqueta);
  }

  btnPlegar.addEventListener('click', () => {
    const plegado = raiz.dataset.lateral !== 'plegado';
    raiz.dataset.lateral = plegado ? 'plegado' : 'abierto';
    window.reele.settings.set({ sidebarCollapsed: plegado });
    pintarPlegado();
  });

  pintarPlegado();

  // --- Progreso del escaneo -------------------------------------------------

  window.reele.library.onProgress(({ phase, done, total }) => {
    escaneo.hidden = false;
    // La fase de recorrido no sabe cuantos archivos hay hasta terminarla, asi
    // que no puede medir nada: en vez de inventarse un porcentaje, la barra
    // recorre de lado a lado.
    const indeterminado = phase === 'walk' || !total;
    escaneo.dataset.indeterminado = String(indeterminado);
    escaneo.style.setProperty('--valor', String(indeterminado ? 0 : done / total));
    escaneoTexto.textContent = indeterminado
      ? `Buscando videos… ${done || ''}`.trim()
      : `Leyendo ${done} de ${total}`;
    if (!indeterminado && done >= total) ocultarEscaneo();
  });

  let cierreEscaneo = 0;
  function ocultarEscaneo() {
    clearTimeout(cierreEscaneo);
    // Un momento con la barra llena antes de irse: desaparecer en el mismo
    // fotograma en que termina se lee como que se ha cancelado.
    cierreEscaneo = setTimeout(() => { escaneo.hidden = true; }, 700);
  }

  window.reele.library.onChanged(() => refrescar());

  // --- Estado de reproduccion en la lista -----------------------------------

  motor.player.on('trackchange', ({ track }) => lista.setActual(track?.id, motor.player.playing));
  motor.player.on('state', ({ playing }) => lista.setActual(motor.player.track?.id, playing));

  window.reele.settings.onChange((patch) => {
    if (patch.clickToPlay !== undefined) lista.setUnClic(patch.clickToPlay);
  });

  // --- Carga ----------------------------------------------------------------

  async function refrescar() {
    const [todos, dirs] = await Promise.all([
      window.reele.library.all(),
      window.reele.library.folders(),
    ]);
    videos = todos;
    carpetas = dirs;

    cuentaVideos.textContent = videos.length ? String(videos.length) : '';
    pintarCarpetas();
    lista.setVideos(fuente());
    ocultarEscaneo();
    return videos;
  }

  if (ajustes.view === 'videos') vista = { tipo: 'videos' };

  return {
    lista,
    refrescar,
    get vista() { return vista; },
    get videos() { return videos; },
    setVista,
    onVista(fn) {
      alCambiarVista.add(fn);
      return () => alCambiarVista.delete(fn);
    },
  };
}

/**
 * Los dos vacios de la lista.
 *
 * "La busqueda no encuentra nada" y "esta vista aun no tiene nada" son dos
 * situaciones distintas y el consejo util es distinto en cada una. Cual de
 * los dos se ensena lo decide el CSS por atributo; ver lista.css.
 */
function vacio(clase, icono, titulo, texto) {
  return el('div', { class: `vacio vacio--${clase}` }, [
    el('span', { class: 'vacio__icono', texto: glifo(icono), 'aria-hidden': 'true' }),
    el('div', { class: 'vacio__titulo', texto: titulo }),
    el('p', { class: 'vacio__texto', texto }),
  ]);
}
