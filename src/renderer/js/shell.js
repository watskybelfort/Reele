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
import { crearSondeo } from './sondeo.js';
import { abrirMenu } from './menu.js';
import { preguntar, confirmar } from './dialogo.js';

/** El titulo de la cabecera segun la vista. Las carpetas y listas usan su nombre. */
const TITULOS = { videos: 'Videos', seguir: 'Seguir viendo', favoritos: 'Favoritos' };

/**
 * El vacio se explica distinto en cada vista.
 *
 * "Anade una carpeta" no ayuda en Seguir viendo, donde puede haber una
 * biblioteca entera y aun asi nada a medias; y "no has dejado nada a medias"
 * seria absurdo en una biblioteca sin un solo archivo.
 */
const VACIOS = {
  videos: ['Aqui todavia no hay nada', 'Anade una carpeta con tus videos o suelta archivos en la ventana.'],
  seguir: ['No has dejado nada a medias', 'Lo que pares por la mitad aparecera aqui para seguirlo donde lo dejaste.'],
  favoritos: ['Sin favoritos', 'Marca con el corazon lo que quieras tener a mano.'],
  lista: ['Esta lista esta vacia', 'Anade videos desde el menu del boton derecho.'],
  carpeta: ['Esta carpeta no tiene videos', 'Puede que solo tenga formatos que Chromium no sabe decodificar.'],
};

export function initShell(motor, ajustes, { colecciones } = {}) {
  const raiz = document.documentElement;
  const cuerpo = $('#vista-cuerpo');
  const titulo = $('#vista-titulo');
  const resumen = $('#vista-resumen');
  const buscador = $('#buscador');
  const escaneo = $('#escaneo');
  const escaneoTexto = $('#escaneo-texto');
  const cuentaVideos = $('#cuenta-videos');
  const cuentaSeguir = $('#cuenta-seguir');
  const cuentaFavoritos = $('#cuenta-favoritos');
  const listaCarpetas = $('#lista-carpetas');
  const listaListas = $('#lista-listas');

  let videos = [];
  let carpetas = [];
  /** Ids de lo que se puede seguir viendo, del mas reciente al mas antiguo. */
  let seguirViendo = [];
  let vista = { tipo: 'videos' };
  /**
   * El orden que eligio el usuario en la cabecera.
   *
   * Se guarda aparte porque "Seguir viendo" impone el suyo —lo ultimo que se
   * dejo a medias va primero— y al salir de esa vista hay que devolver el
   * de antes, no dejar la biblioteca ordenada por una regla invisible.
   */
  let ordenUsuario = { por: ajustes.sortBy ?? 'title', dir: ajustes.sortDir ?? 'asc' };
  const alCambiarVista = new Set();

  pintarGlifo($('#icono-videos'), 'video');
  pintarGlifo($('#icono-seguir'), 'reproducir');
  pintarGlifo($('#icono-favoritos'), 'corazon');
  pintarGlifo($('#btn-nueva-lista'), 'anadir');
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
    onFavorito: colecciones ? (video) => colecciones.alternar(video?.id) : undefined,
    onMenu: (video, indice, evento) => menuDeVideo(video, indice, evento),
    onOrden: ({ por, dir }) => {
      if (por === 'ninguno') return;
      ordenUsuario = { por, dir };
      window.reele.settings.set({ sortBy: por, sortDir: dir });
    },
    onFiltrado: () => pintarResumen(),
  });

  const vacioVista = vacio('vista', 'video', '', '');
  cuerpo.dataset.modo = 'lista';
  cuerpo.append(
    lista.nodo,
    vacio('busqueda', 'buscar', 'Sin resultados', 'Prueba con otra cosa: se busca por titulo, por nombre de archivo y por carpeta.'),
    vacioVista,
  );

  /*
   * El orden se aplica DESPUES de montar todo lo de arriba.
   *
   * setOrden repinta, repintar llama a pintarResumen, y pintarResumen toca
   * el nodo del estado vacio. Puesto justo detras de crearLista —que es
   * donde pide el ojo— se ejecuta antes de que ese nodo exista y la shell
   * entera se cae con un error de inicializacion.
   */
  lista.setOrden(ajustes.sortBy, ajustes.sortDir);

  function pintarVacio() {
    const [encabezado, texto] = VACIOS[vista.tipo] ?? VACIOS.videos;
    vacioVista.querySelector('.vacio__titulo').textContent = encabezado;
    vacioVista.querySelector('.vacio__texto').textContent = texto;
  }

  // --- Cabecera -------------------------------------------------------------

  function pintarResumen() {
    const enPantalla = lista.visibles;
    titulo.textContent = vista.nombre ?? TITULOS[vista.tipo] ?? 'Videos';

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
    pintarVacio();
  }

  // --- Vistas ---------------------------------------------------------------

  /** Los videos de la vista actual, antes de aplicar la busqueda. */
  function fuente() {
    if (vista.tipo === 'carpeta') {
      const raizCarpeta = vista.ruta.toLowerCase();
      return videos.filter((v) => v.path.toLowerCase().startsWith(raizCarpeta));
    }
    if (vista.tipo === 'seguir') {
      // El orden lo da la lista de ids, que ya viene de lo mas reciente a lo
      // mas antiguo. Se mapea en vez de filtrar para no perderlo.
      return porIds(seguirViendo);
    }
    if (vista.tipo === 'favoritos') {
      return videos.filter((v) => colecciones?.tiene(v.id));
    }
    if (vista.tipo === 'lista') {
      const guardada = colecciones?.lista(vista.id);
      // Igual que arriba: el orden de una lista lo puso el usuario a mano y
      // es lo unico que la distingue de un filtro cualquiera.
      return guardada ? porIds(guardada.tracks) : [];
    }
    return videos;
  }

  function porIds(ids) {
    const indice = new Map(videos.map((v) => [v.id, v]));
    return ids.map((id) => indice.get(id)).filter(Boolean);
  }

  /** Vistas donde el orden ES la informacion y no se debe tocar. */
  const ORDEN_PROPIO = new Set(['seguir', 'lista']);

  function setVista(nueva) {
    vista = nueva;
    // Reordenar alfabeticamente "Seguir viendo" o una lista hecha a mano las
    // convertiria en otra lista cualquiera.
    if (ORDEN_PROPIO.has(vista.tipo)) lista.setOrden('ninguno');
    else lista.setOrden(ordenUsuario.por, ordenUsuario.dir);
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
    $('#nav-seguir').setAttribute('aria-current', String(vista.tipo === 'seguir'));
    $('#nav-favoritos').setAttribute('aria-current', String(vista.tipo === 'favoritos'));
    for (const nodo of listaCarpetas.querySelectorAll('.carpeta')) {
      nodo.dataset.activa = String(vista.tipo === 'carpeta' && nodo.dataset.ruta === vista.ruta);
    }
    for (const nodo of listaListas.querySelectorAll('.lateral__item')) {
      nodo.setAttribute('aria-current', String(vista.tipo === 'lista' && nodo.dataset.id === vista.id));
    }
  }

  $('#nav-videos').addEventListener('click', () => setVista({ tipo: 'videos' }));
  $('#nav-seguir').addEventListener('click', () => setVista({ tipo: 'seguir' }));
  $('#nav-favoritos').addEventListener('click', () => setVista({ tipo: 'favoritos' }));

  // --- Listas ---------------------------------------------------------------

  function pintarListas() {
    const listas = colecciones?.listas ?? [];
    listaListas.replaceChildren(...listas.map((guardada) => el('button', {
      class: 'lateral__item',
      dataset: { id: guardada.id },
      'aria-current': 'false',
      title: guardada.name,
      onClick: () => setVista({ tipo: 'lista', id: guardada.id, nombre: guardada.name }),
      onContextmenu: (e) => {
        e.preventDefault();
        menuDeLista(guardada, e);
      },
    }, [
      el('span', { class: 'lateral__icono', texto: glifo('lista'), 'aria-hidden': 'true' }),
      el('span', { class: 'lateral__texto', texto: guardada.name }),
      el('span', { class: 'lateral__cuenta tabular', texto: guardada.tracks.length ? String(guardada.tracks.length) : '' }),
    ])));
    pintarNavegacion();
  }

  function menuDeLista(guardada, evento) {
    abrirMenu({
      x: evento.clientX,
      y: evento.clientY,
      items: [
        {
          texto: 'Reproducir la lista',
          onElegir: () => {
            const videos_ = porIds(guardada.tracks);
            if (videos_.length) motor.queue.setContext(videos_, { startIndex: 0 });
          },
        },
        { separador: true },
        {
          texto: 'Cambiar el nombre',
          onElegir: async () => {
            const nombre = await preguntar({
              titulo: 'Cambiar el nombre',
              valor: guardada.name,
            });
            if (nombre) await colecciones.renombrar(guardada.id, nombre);
          },
        },
        {
          texto: 'Borrar la lista',
          onElegir: async () => {
            const si = await confirmar({
              titulo: `Borrar "${guardada.name}"`,
              texto: 'Solo se borra la lista. Los archivos no se tocan.',
              aceptar: 'Borrar',
              peligroso: true,
            });
            if (!si) return;
            await colecciones.quitar(guardada.id);
            if (vista.tipo === 'lista' && vista.id === guardada.id) setVista({ tipo: 'videos' });
          },
        },
      ],
    });
  }

  $('#btn-nueva-lista').addEventListener('click', async () => {
    const nombre = await preguntar({
      titulo: 'Nueva lista',
      texto: 'Una lista guarda referencias, no copias: los archivos se quedan donde estan.',
      placeholder: 'Nombre de la lista',
      aceptar: 'Crear',
    });
    if (!nombre) return;
    const creada = await colecciones.crear(nombre, []);
    if (creada) setVista({ tipo: 'lista', id: creada.id, nombre: creada.name });
  });

  // --- Menu de un video -----------------------------------------------------

  function menuDeVideo(video, indice, evento) {
    if (!video) return;
    const enLista = vista.tipo === 'lista';

    abrirMenu({
      x: evento.clientX,
      y: evento.clientY,
      items: [
        {
          texto: 'Reproducir',
          onElegir: () => motor.queue.setContext(lista.visibles, { startIndex: indice }),
        },
        {
          texto: 'Ver a continuacion',
          onElegir: () => motor.queue.addNext(video),
        },
        {
          texto: 'Anadir al final de la cola',
          onElegir: () => motor.queue.addLast(video),
        },
        { separador: true },
        {
          texto: colecciones?.tiene(video.id) ? 'Quitar de favoritos' : 'Anadir a favoritos',
          onElegir: () => colecciones?.alternar(video.id),
        },
        {
          texto: 'Anadir a una lista…',
          onElegir: () => menuDeListas(video, evento),
        },
        enLista ? {
          texto: 'Quitar de esta lista',
          onElegir: async () => {
            const guardada = colecciones.lista(vista.id);
            const real = guardada?.tracks.indexOf(video.id) ?? -1;
            if (real >= 0) await colecciones.quitarEn(vista.id, real);
          },
        } : null,
        { separador: true },
        {
          texto: 'Abrir la ubicacion del archivo',
          onElegir: () => window.reele.library.reveal(video.path),
        },
        {
          texto: 'Empezar de cero la proxima vez',
          desactivado: !(lista.nodo && video.id),
          onElegir: async () => {
            await window.reele.progreso.olvidar(video.id);
            await refrescarProgreso();
          },
        },
      ].filter(Boolean),
    });
  }

  /**
   * El segundo menu, para elegir a que lista va.
   *
   * Se abre encima del primero en vez de colgar de el como submenu: un menu
   * de un solo nivel se coloca solo, se cierra solo y se recorre con el
   * teclado sin inventar nada. Los submenus con su temporizador de apertura
   * son mucho codigo para dos clics al mes.
   */
  function menuDeListas(video, evento) {
    const listas = colecciones?.listas ?? [];
    abrirMenu({
      titulo: 'Anadir a',
      x: evento.clientX,
      y: evento.clientY,
      items: [
        ...listas.map((guardada) => ({
          texto: guardada.name,
          detalle: guardada.tracks.includes(video.id) ? 'ya esta' : undefined,
          desactivado: guardada.tracks.includes(video.id),
          onElegir: () => colecciones.anadir(guardada.id, video.id),
        })),
        listas.length ? { separador: true } : null,
        {
          texto: 'Lista nueva…',
          onElegir: async () => {
            const nombre = await preguntar({ titulo: 'Nueva lista', aceptar: 'Crear' });
            if (nombre) await colecciones.crear(nombre, [video.id]);
          },
        },
      ].filter(Boolean),
    });
  }

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

  // --- Favoritos y listas al dia --------------------------------------------

  function pintarFavoritos() {
    const cuantos = colecciones?.favoritos.size ?? 0;
    cuentaFavoritos.textContent = cuantos ? String(cuantos) : '';
    lista.setFavoritos(colecciones?.favoritos);
  }

  colecciones?.on('favoritos', () => {
    pintarFavoritos();
    // Estando en Favoritos, quitar uno tiene que sacarlo de la lista, no solo
    // apagarle el corazon.
    if (vista.tipo === 'favoritos') lista.setVideos(fuente());
  });

  colecciones?.on('listas', () => {
    pintarListas();
    if (vista.tipo !== 'lista') return;
    const guardada = colecciones.lista(vista.id);
    // La lista que se estaba mirando puede haber desaparecido desde otra
    // ventana o haber cambiado de nombre.
    if (!guardada) setVista({ tipo: 'videos' });
    else {
      vista = { ...vista, nombre: guardada.name };
      lista.setVideos(fuente());
      pintarResumen();
    }
  });

  // --- Sondeo ---------------------------------------------------------------

  /**
   * Va abriendo en segundo plano los videos que aun no tienen duracion ni
   * portada. Se frena mientras hay algo en pantalla: decodificar dos videos
   * a la vez le roba imagen al que el usuario esta mirando.
   */
  const sondeo = crearSondeo({
    pausa: () => (motor.player.playing ? 900 : 120),
    onVideo: (video) => actualizarVideo(video),
  });

  window.reele.library.onEnriquecido((video) => actualizarVideo(video));

  let repintarResumen = 0;
  function actualizarVideo(video) {
    const i = videos.findIndex((v) => v.id === video.id);
    if (i >= 0) videos[i] = video;
    lista.actualizar(video);
    // El resumen se recalcula agrupado: con doscientos videos sondeandose
    // seguidos, recontarlo en cada uno es doscientas pasadas por la lista
    // entera para cambiar un numero que nadie esta mirando todavia.
    clearTimeout(repintarResumen);
    repintarResumen = setTimeout(pintarResumen, 300);
  }

  // --- Estado de reproduccion en la lista -----------------------------------

  motor.player.on('trackchange', ({ track }) => lista.setActual(track?.id, motor.player.playing));
  motor.player.on('state', ({ playing }) => lista.setActual(motor.player.track?.id, playing));

  window.reele.settings.onChange((patch) => {
    if (patch.clickToPlay !== undefined) lista.setUnClic(patch.clickToPlay);
  });

  // --- Carga ----------------------------------------------------------------

  async function refrescar() {
    const [todos, dirs, marcas, aMedias] = await Promise.all([
      window.reele.library.all(),
      window.reele.library.folders(),
      window.reele.progreso.fracciones(),
      window.reele.progreso.seguirViendo(),
    ]);
    videos = todos;
    carpetas = dirs;
    seguirViendo = aMedias;

    cuentaVideos.textContent = videos.length ? String(videos.length) : '';
    cuentaSeguir.textContent = seguirViendo.length ? String(seguirViendo.length) : '';
    lista.setProgreso(marcas);
    pintarFavoritos();
    pintarCarpetas();
    pintarListas();
    lista.setVideos(fuente());
    ocultarEscaneo();

    // Sin await: la biblioteca ya esta en pantalla y el sondeo puede tardar
    // minutos en una coleccion grande. Esperarlo aqui dejaria la lista sin
    // pintar hasta tener la ultima miniatura.
    sondeo.arrancar();
    return videos;
  }

  /**
   * Solo las marcas de "por donde iba", sin volver a pedir la biblioteca.
   *
   * Se llama al pausar y al terminar un video, que puede ser cada pocos
   * minutos. Pasar por `refrescar` entero traeria otra vez los miles de
   * videos por IPC y, peor, devolveria la lista al principio.
   */
  async function refrescarProgreso() {
    const [marcas, aMedias] = await Promise.all([
      window.reele.progreso.fracciones(),
      window.reele.progreso.seguirViendo(),
    ]);
    seguirViendo = aMedias;
    cuentaSeguir.textContent = seguirViendo.length ? String(seguirViendo.length) : '';
    lista.setProgreso(marcas);
    // Estando en "Seguir viendo", lo que cambia no es solo la barrita: puede
    // haber entrado o salido una fila entera de la lista.
    if (vista.tipo === 'seguir') lista.setVideos(fuente());
  }

  if (ajustes.view === 'videos') vista = { tipo: 'videos' };

  return {
    lista,
    refrescar,
    refrescarProgreso,
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
