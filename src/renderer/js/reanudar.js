/**
 * Continuar donde lo dejaste.
 *
 * Dos mitades: ir apuntando por donde va, y arrancar ahi la proxima vez.
 *
 * El sitio donde se decide el arranque es el enganche `antesDeReproducir` de
 * la cola, no un salto despues de darle al play. Saltando despues se ven los
 * primeros fotogramas del principio antes del brinco, y eso se lee como que
 * el reproductor se ha equivocado y se ha corregido, no como una funcion.
 */

import { $, el, formatoTiempo } from './dom.js';

/** Cada cuanto se apunta la posicion mientras corre. */
const CADA_MS = 5000;

/** Cuanto se queda el aviso de "reanudado" antes de irse solo. */
const AVISO_MS = 9000;

export function crearReanudar(motor, opciones = {}) {
  const { player, queue } = motor;
  let activo = opciones.ajustes?.resumePlayback !== false;
  let ultimoGuardado = 0;
  let temporizadorAviso = 0;
  const alCambiar = new Set();

  const aviso = el('div', { class: 'escenario__aviso', hidden: true, role: 'status' });
  $('#escenario').append(aviso);

  // --- Arranque -------------------------------------------------------------

  queue.antesDeReproducir = async (track) => {
    esconderAviso();
    if (!activo || !track?.id) return null;

    const marca = await window.reele.progreso.de(track.id);
    if (!marca || marca.visto || !(marca.t > 0)) return null;

    mostrarAviso(marca.t, track);
    return { startAt: marca.t };
  };

  function mostrarAviso(segundos, track) {
    const volver = el('button', {
      class: 'escenario__aviso-accion',
      texto: 'Empezar de cero',
      onClick: () => {
        player.seek(0);
        window.reele.progreso.olvidar(track.id);
        esconderAviso();
        avisar();
      },
    });

    aviso.replaceChildren(
      el('span', { texto: `Seguimos en ${formatoTiempo(segundos)}` }),
      volver,
    );
    aviso.hidden = false;
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(esconderAviso, AVISO_MS);
  }

  function esconderAviso() {
    clearTimeout(temporizadorAviso);
    aviso.hidden = true;
  }

  // --- Apuntar --------------------------------------------------------------

  function guardar(forzar = false) {
    const track = player.track;
    if (!activo || !track?.id) return;
    const t = player.currentTime;
    const dur = player.duration;
    if (!forzar && Date.now() - ultimoGuardado < CADA_MS) return;
    ultimoGuardado = Date.now();
    window.reele.progreso.guardar(track.id, t, dur);
  }

  player.on('time', () => guardar());

  // Al pausar se apunta si o si: es el momento en que mas gente cierra la
  // ventana, y con el guardado solo cada cinco segundos se perderian los
  // ultimos que se vieron.
  player.on('state', ({ playing }) => {
    if (!playing) {
      guardar(true);
      avisar();
    }
  });

  player.on('ended', ({ track }) => {
    if (!activo || !track?.id) return;
    window.reele.progreso.visto(track.id, player.duration);
    avisar();
  });

  // Cambiar de video tambien cierra el anterior: sin esto, saltar al
  // siguiente con el boton perderia la posicion del que se estaba viendo.
  let anterior = null;
  player.on('trackchange', ({ track }) => {
    if (anterior && anterior.id !== track?.id) avisar();
    anterior = track;
  });

  // Cerrar la ventana no da tiempo a nada asincrono, pero `send` no espera
  // respuesta y llega igual.
  window.addEventListener('beforeunload', () => guardar(true));

  window.reele.settings.onChange((patch) => {
    if (patch.resumePlayback !== undefined) activo = patch.resumePlayback !== false;
  });

  function avisar() {
    for (const fn of alCambiar) fn();
  }

  return {
    get activo() { return activo; },
    guardar,
    esconderAviso,
    /** Avisa cuando alguna marca ha podido cambiar, para repintar la lista. */
    onCambio(fn) {
      alCambiar.add(fn);
      return () => alCambiar.delete(fn);
    },
  };
}
