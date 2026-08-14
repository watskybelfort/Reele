/**
 * El escenario: la superficie donde se ve el video.
 *
 * Ocupa la misma celda de la rejilla que la biblioteca y se turnan. Aqui vive
 * el <video>, los gestos sobre la imagen y el escondite de los mandos.
 *
 * La decision de fondo: NO hay dos juegos de controles. El unico es el
 * transporte de abajo, que en ventana es una fila mas de la rejilla y a
 * pantalla completa pasa a flotar sobre la imagen y se esconde solo. Dos
 * superficies de mandos —una para la ventana y otra para pantalla completa—
 * significa mantener dos veces cada boton y que uno de los dos se quede
 * atras; y se nota siempre, porque el que se queda atras es el que menos se
 * mira al programar y mas se usa al ver una pelicula.
 */

import { $, glifo, pintarGlifo } from './dom.js';

/** Sin mover el raton, los mandos y el cursor se van a este tiempo. */
const ESPERA_OCULTAR = 2600;

/**
 * Ventana en la que un segundo clic cuenta como doble.
 *
 * Sin esta espera, un doble clic para ir a pantalla completa dispara antes el
 * clic sencillo y el video se queda en pausa detras. 220 ms es lo que tarda
 * un doble clic normal de Windows sin que un clic suelto se sienta lento.
 */
const ESPERA_DOBLE = 220;

export function crearEscenario(player, opciones = {}) {
  const raizDoc = document.documentElement;
  const escenario = $('#escenario');
  const video = $('#video');
  const cargando = $('#escenario-cargando');
  const pulso = $('#escenario-pulso');
  const error = $('#escenario-error');
  const volver = $('#btn-volver');

  let abierto = false;
  let temporizadorOcultar = 0;
  let clicPendiente = 0;
  const alCambiar = new Set();

  pintarGlifo(volver, 'atras');

  // --- Encaje ---------------------------------------------------------------

  /**
   * 'contain' respeta el encuadre y deja bandas; 'cover' llena la ventana
   * recortando arriba y abajo. Va por atributo y no por clase porque el CSS
   * tiene que poder mirar los dos estados sin conocer nombres de clase.
   */
  function setEncaje(modo) {
    const valor = modo === 'cover' ? 'cover' : 'contain';
    escenario.dataset.encaje = valor;
    return valor;
  }

  function alternarEncaje() {
    const nuevo = escenario.dataset.encaje === 'cover' ? 'contain' : 'cover';
    setEncaje(nuevo);
    window.reele.settings.set({ encaje: nuevo });
    return nuevo;
  }

  setEncaje(opciones.ajustes?.encaje);

  // --- Abrir y cerrar -------------------------------------------------------

  function mostrar() {
    if (abierto) return;
    abierto = true;
    raizDoc.dataset.escenario = 'true';
    despertar();
    avisar();
  }

  function ocultar() {
    if (!abierto) return;
    abierto = false;
    raizDoc.dataset.escenario = 'false';
    // Al salir del escenario los mandos vuelven siempre: si el video se
    // quedo en pausa con ellos escondidos, la biblioteca apareceria con el
    // transporte invisible y el cursor apagado.
    despertar(true);
    avisar();
  }

  function avisar() {
    for (const fn of alCambiar) fn(abierto);
  }

  // --- Esconder los mandos --------------------------------------------------

  /**
   * Solo se esconden cuando el video ocupa TODO: a pantalla completa y en el
   * mini. En ventana normal el transporte es una fila de la rejilla, no tapa
   * nada, y hacerlo desaparecer solo consigue que el usuario mueva el raton
   * en circulos para recuperarlo.
   */
  function puedeEsconder() {
    return abierto && player.playing
      && (raizDoc.dataset.pantalla === 'true' || raizDoc.dataset.mini === 'true');
  }

  function despertar(forzar = false) {
    raizDoc.dataset.mandos = 'visibles';
    clearTimeout(temporizadorOcultar);
    if (forzar) return;
    temporizadorOcultar = setTimeout(() => {
      if (puedeEsconder()) raizDoc.dataset.mandos = 'ocultos';
    }, ESPERA_OCULTAR);
  }

  // Sobre el propio transporte no se esconde nunca: estar eligiendo el
  // volumen y que el mando se desvanezca bajo el puntero es de las cosas mas
  // molestas que puede hacer un reproductor.
  document.addEventListener('pointermove', (e) => {
    const sobreMandos = e.target.closest?.('.transporte, .escenario__volver');
    if (sobreMandos) {
      clearTimeout(temporizadorOcultar);
      raizDoc.dataset.mandos = 'visibles';
      return;
    }
    despertar();
  });

  player.on('state', ({ playing }) => {
    if (playing) despertar();
    else despertar(true);
  });

  // --- Gestos sobre la imagen -----------------------------------------------

  escenario.addEventListener('click', (e) => {
    // Los botones que flotan encima tienen sus propios manejadores.
    if (e.target.closest('button')) return;
    if (!player.track) return;

    // El clic sencillo espera por si viene un segundo. Ver ESPERA_DOBLE.
    clearTimeout(clicPendiente);
    clicPendiente = setTimeout(() => {
      const sonando = player.toggle();
      latido(sonando ? 'reproducir' : 'pausa');
    }, ESPERA_DOBLE);
  });

  escenario.addEventListener('dblclick', (e) => {
    if (e.target.closest('button')) return;
    clearTimeout(clicPendiente);
    window.reele.window.togglePantalla();
  });

  /**
   * La rueda cambia el volumen, como en VLC y en mpv.
   *
   * `passive: false` porque hace falta parar el desplazamiento: sin eso, en
   * ventana pequena la rueda mueve ademas la lista de detras.
   */
  escenario.addEventListener('wheel', (e) => {
    e.preventDefault();
    const paso = e.deltaY < 0 ? 0.05 : -0.05;
    opciones.onVolumen?.(player.volume + paso);
  }, { passive: false });

  volver.addEventListener('click', () => ocultar());

  // --- Senales de estado ----------------------------------------------------

  /**
   * El destello del centro.
   *
   * Al pulsar sobre la imagen no cambia nada visible —el video sigue en el
   * mismo fotograma— asi que sin esta senal parece que el clic no ha hecho
   * nada. La animacion se reinicia quitando y volviendo a poner la clase, con
   * un reflow forzado en medio: sin el, el navegador agrupa las dos
   * escrituras y la animacion no vuelve a empezar.
   */
  function latido(nombre) {
    pulso.textContent = glifo(nombre);
    pulso.classList.remove('escenario__pulso--vivo');
    void pulso.offsetWidth;
    pulso.classList.add('escenario__pulso--vivo');
  }

  player.on('buffering', ({ buffering }) => {
    cargando.hidden = !buffering;
  });

  player.on('error', ({ track, message }) => {
    error.hidden = false;
    error.textContent = `No pude reproducir ${track?.fileName ?? 'el archivo'}: ${message}.`;
  });

  player.on('trackchange', ({ track }) => {
    error.hidden = true;
    cargando.hidden = true;
    escenario.dataset.hayVideo = String(!!track);
    if (track) mostrar();
  });

  escenario.dataset.hayVideo = 'false';

  return {
    video,
    get abierto() { return abierto; },
    mostrar,
    ocultar,
    alternar() {
      if (abierto) ocultar();
      else mostrar();
    },
    setEncaje,
    alternarEncaje,
    latido,
    despertar,
    onCambio(fn) {
      alCambiar.add(fn);
      return () => alCambiar.delete(fn);
    },
  };
}
