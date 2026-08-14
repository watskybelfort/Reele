/**
 * Panel de ajustes.
 *
 * Se construye entero desde una descripcion: cada fila dice que ajuste toca,
 * de que tipo es y que hace al cambiar. Con el marcado escrito a mano en el
 * HTML, cada ajuste nuevo son quince lineas de plantilla mas su cableado, y
 * al tercero ya hay dos que se pintan distinto sin que nadie sepa por que.
 *
 * Todo lo que se toca aqui viaja por `settings.set`, y el proceso principal
 * devuelve el aviso a la pagina entera. Asi el panel no tiene que avisar a
 * nadie: quien dependa del ajuste ya se ha enterado por su cuenta.
 */

import { $, el, glifo, pintarGlifo } from './dom.js';

const BACKDROPS = [
  ['acrylic', 'Acrilico', 'El del sistema. Windows lo apaga al perder el foco.'],
  ['acrylic-always', 'Acrilico siempre', 'Se mantiene difuminado aunque la ventana no tenga el foco.'],
  ['mica', 'Mica', 'Tinta el fondo y difumina menos.'],
  ['tabbed', 'Mica alternativa', 'Como mica, un punto mas oscura.'],
  ['none', 'Sin vidrio', 'La pagina pinta su propio fondo.'],
];

const IDIOMAS_SUB = [
  ['', 'No elegir ninguno solo'],
  ['es', 'Espanol'],
  ['en', 'Ingles'],
  ['fr', 'Frances'],
  ['de', 'Aleman'],
  ['it', 'Italiano'],
  ['pt', 'Portugues'],
];

const IDIOMAS_AUDIO = [
  ['', 'La que traiga el archivo'],
  ['spa', 'Espanol'],
  ['eng', 'Ingles'],
  ['fra', 'Frances'],
  ['deu', 'Aleman'],
  ['ita', 'Italiano'],
  ['por', 'Portugues'],
  ['jpn', 'Japones'],
];

export function crearAjustes({ ajustes, atajos, escenario, subtitulos }) {
  let valores = { ...ajustes };
  let abierto = false;

  const cuerpo = el('div', { class: 'ajustes__cuerpo' });
  const panel = el('div', { class: 'ajustes flotante', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Ajustes' }, [
    el('header', { class: 'ajustes__cabecera' }, [
      el('h2', { class: 'ajustes__titulo', texto: 'Ajustes' }),
      el('button', {
        class: 'icono-btn',
        texto: glifo('quitar'),
        title: 'Cerrar',
        'aria-label': 'Cerrar los ajustes',
        onClick: () => cerrar(),
      }),
    ]),
    cuerpo,
  ]);

  const velo = el('div', { class: 'ajustes__velo', hidden: true, onClick: () => cerrar() }, [panel]);
  document.body.append(velo);

  // --- Guardado -------------------------------------------------------------

  function guardar(patch) {
    valores = { ...valores, ...patch };
    window.reele.settings.set(patch);
  }

  window.reele.settings.onChange((patch) => {
    valores = { ...valores, ...patch };
  });

  // --- Piezas ---------------------------------------------------------------

  function fila(titulo, ayuda, control) {
    return el('div', { class: 'ajuste' }, [
      el('div', { class: 'ajuste__texto' }, [
        el('div', { class: 'ajuste__titulo', texto: titulo }),
        ayuda ? el('div', { class: 'ajuste__ayuda', texto: ayuda }) : null,
      ]),
      el('div', { class: 'ajuste__control' }, [control]),
    ]);
  }

  /** Interruptor. El `role=switch` es lo que lo hace legible a un lector. */
  function interruptor(clave, alCambiar) {
    const boton = el('button', {
      class: 'interruptor',
      role: 'switch',
      'aria-checked': String(!!valores[clave]),
    });
    boton.addEventListener('click', () => {
      const nuevo = boton.getAttribute('aria-checked') !== 'true';
      boton.setAttribute('aria-checked', String(nuevo));
      guardar({ [clave]: nuevo });
      alCambiar?.(nuevo);
    });
    return boton;
  }

  function eleccion(clave, opciones, alCambiar) {
    const select = el('select', { class: 'eleccion' });
    for (const [valor, etiqueta] of opciones) {
      select.append(el('option', { value: valor, texto: etiqueta, selected: valores[clave] === valor || undefined }));
    }
    select.value = String(valores[clave] ?? '');
    select.addEventListener('change', () => {
      guardar({ [clave]: select.value });
      alCambiar?.(select.value);
    });
    return select;
  }

  /**
   * Deslizador nativo, aqui si.
   *
   * En el transporte hace falta uno propio por las tres capas y el globo del
   * tiempo; en un ajuste no hay nada de eso y un <input type=range> se maneja
   * mejor con el teclado que cualquier cosa que se escriba a mano.
   */
  function deslizador(clave, { min, max, paso, formato }, alCambiar) {
    const valorTexto = el('span', { class: 'deslizador__valor tabular' });
    const input = el('input', {
      class: 'deslizador',
      type: 'range',
      min: String(min),
      max: String(max),
      step: String(paso),
    });
    input.value = String(valores[clave] ?? min);
    const pintar = () => { valorTexto.textContent = formato(Number(input.value)); };
    pintar();
    input.addEventListener('input', () => {
      pintar();
      const v = Number(input.value);
      guardar({ [clave]: v });
      alCambiar?.(v);
    });
    return el('div', { class: 'deslizador__caja' }, [input, valorTexto]);
  }

  function seccion(titulo, filas) {
    return el('section', { class: 'ajustes__seccion' }, [
      el('h3', { class: 'ajustes__seccion-titulo', texto: titulo }),
      ...filas,
    ]);
  }

  // --- Contenido ------------------------------------------------------------

  function construir() {
    cuerpo.replaceChildren(
      seccion('Vidrio', [
        fila('Fondo de la ventana', 'Que efecto compone Windows detras de la aplicacion.',
          eleccion('backdrop', BACKDROPS.map(([v, t]) => [v, t]), (v) => window.reele.backdrop.apply(v))),
        fila('Veladura', 'Cuanto pinta la interfaz por encima del vidrio. Si se ve turbio, bajala.',
          deslizador('glassOpacity', { min: 0.15, max: 0.85, paso: 0.01, formato: (v) => `${Math.round(v * 100)}%` })),
        fila('Color del fotograma', 'El tinte y el acento salen de la imagen de lo que se esta viendo.',
          interruptor('adaptiveColor')),
      ]),

      seccion('Reproduccion', [
        fila('Encadenar con el siguiente', 'Al terminar, sigue con el siguiente de la cola.',
          interruptor('encadenar')),
        fila('Un clic reproduce', 'Apagado, hace falta el doble clic en la lista.',
          interruptor('clickToPlay')),
        fila('Llenar la ventana', 'Recorta la imagen para no dejar bandas. Se cambia tambien con E.',
          botonEncaje()),
        fila('Continuar donde lo dejaste', 'Guarda la posicion de cada video y vuelve a ella.',
          interruptor('resumePlayback')),
        fila('Minimo para recordar', 'Por debajo de esto no se guarda la posicion.',
          deslizador('resumeMinSeconds', { min: 10, max: 300, paso: 10, formato: (v) => `${v} s` })),
      ]),

      seccion('Subtitulos', [
        fila('Ponerlos si los hay', 'Busca archivos .srt, .vtt y .ass junto al video.',
          interruptor('subtitlesEnabled', (v) => subtitulos?.setEncendidos(v))),
        fila('Idioma preferido', 'Se enciende solo el que coincida. Si no hay ninguno, no pone otro.',
          eleccion('subtitleLanguage', IDIOMAS_SUB)),
        fila('Tamano', 'Sobre el tamano que se calcula segun lo grande que este la imagen.',
          deslizador('subtitleSize', { min: 60, max: 200, paso: 5, formato: (v) => `${v}%` },
            (v) => subtitulos?.setTamano(v))),
      ]),

      seccion('Audio', [
        fila('Idioma preferido', 'Cuando el archivo trae varias pistas, se enciende la de este idioma.',
          eleccion('audioLanguage', IDIOMAS_AUDIO)),
      ]),

      seccion('Sistema', [
        fila('Mantener la pantalla encendida', 'Impide el salvapantallas mientras hay algo en marcha.',
          interruptor('keepAwake')),
        fila('Icono en la bandeja', 'Con esto puesto, la X esconde la ventana en vez de cerrarla.',
          interruptor('minimizeToTray')),
        fila('Teclas multimedia', 'Deja que las teclas de play y pausa del teclado manden sobre Reele.',
          interruptor('mediaKeys')),
        fila('Avisos', 'Un globo al empezar un video, solo si la ventana no esta delante.',
          interruptor('showNotifications')),
      ]),

      seccion('Atajos', [
        el('div', { class: 'atajos' }, (atajos?.acciones ?? []).map((accion) =>
          el('div', { class: 'atajo' }, [
            el('span', { class: 'atajo__texto', texto: accion.texto }),
            el('span', { class: 'atajo__tecla', texto: accion.atajo }),
          ]))),
      ]),

      seccion('Reele', [
        el('div', { class: 'ajustes__pie', id: 'ajustes-info' }),
      ]),
    );

    pintarInfo();
  }

  /**
   * El encaje no es un ajuste booleano cualquiera: lo cambia tambien la tecla
   * E y el menu, asi que el boton lee del escenario en vez de llevar su
   * propia copia. Con dos copias, abrir Ajustes despues de pulsar E ensena lo
   * contrario de lo que se ve en pantalla.
   */
  function botonEncaje() {
    const boton = el('button', { class: 'interruptor', role: 'switch' });
    const pintar = () => {
      boton.setAttribute('aria-checked', String($('#escenario').dataset.encaje === 'cover'));
    };
    boton.addEventListener('click', () => {
      escenario?.alternarEncaje();
      pintar();
    });
    pintar();
    return boton;
  }

  async function pintarInfo() {
    const info = await window.reele.app.info();
    const nodo = $('#ajustes-info');
    if (!nodo) return;
    nodo.replaceChildren(
      el('div', { texto: `Version ${info.version}` }),
      el('button', {
        class: 'ajustes__enlace',
        texto: 'Abrir la carpeta de datos',
        title: info.userData,
        onClick: () => window.reele.library.reveal(info.userData),
      }),
      el('div', {
        class: 'ajustes__nota',
        texto: 'Reele reproduce lo que Chromium sabe decodificar: H.264, VP8, VP9 y AV1. '
          + 'HEVC solo si la maquina lo hace por hardware, y el audio AC3 o DTS no va nunca — '
          + 'eso se nota como un video que se ve pero no suena.',
      }),
    );
  }

  // --- Abrir y cerrar -------------------------------------------------------

  function abrir() {
    if (abierto) return;
    construir();
    velo.hidden = false;
    abierto = true;
    // El primer control recibe el foco: sin esto, Tab desde aqui recorre la
    // aplicacion de detras, que esta tapada.
    panel.querySelector('button, select, input')?.focus();
  }

  function cerrar() {
    if (!abierto) return;
    velo.hidden = true;
    abierto = false;
  }

  velo.addEventListener('click', (e) => {
    // Solo el velo cierra; el panel esta dentro y su clic no debe subir.
    if (e.target === velo) cerrar();
  });

  panel.addEventListener('click', (e) => e.stopPropagation());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && abierto) {
      e.preventDefault();
      // Se para aqui: si sube, Escape saldria ademas de pantalla completa o
      // volveria a la biblioteca detras del panel que se acaba de cerrar.
      e.stopPropagation();
      cerrar();
    }
    if (e.key === ',' && e.ctrlKey) {
      e.preventDefault();
      alternar();
    }
  }, true);

  function alternar() {
    if (abierto) cerrar();
    else abrir();
  }

  const boton = $('#btn-ajustes');
  if (boton) {
    pintarGlifo($('#icono-ajustes'), 'ajustes');
    boton.addEventListener('click', alternar);
  }

  return { abrir, cerrar, alternar, get abierto() { return abierto; } };
}
