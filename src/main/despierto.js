'use strict';

const { powerSaveBlocker } = require('electron');

/**
 * Que la pantalla no se apague mientras se esta viendo algo.
 *
 * Es la diferencia mas visible entre un reproductor de musica y uno de video.
 * A Sounde no le hace falta —la musica sigue sonando con la pantalla
 * apagada—, pero aqui, sin esto, a la media hora de pelicula salta el
 * salvapantallas o se apaga el monitor y hay que mover el raton cada poco
 * como si el programa no estuviera haciendo nada.
 *
 * Se usa 'prevent-display-sleep' y no 'prevent-app-suspension': el segundo
 * mantiene el proceso vivo pero deja que la pantalla se apague, que es
 * exactamente lo que NO se quiere.
 *
 * El bloqueo se suelta al pausar. Dejarlo puesto mientras la pelicula esta
 * en pausa impide que el equipo descanse por algo que nadie esta mirando.
 */

let id = null;

function activar(si) {
  if (si && id === null) {
    id = powerSaveBlocker.start('prevent-display-sleep');
  } else if (!si && id !== null) {
    try {
      powerSaveBlocker.stop(id);
    } catch { /* ya se habia soltado */ }
    id = null;
  }
  return activo();
}

function activo() {
  return id !== null && powerSaveBlocker.isStarted(id);
}

/** Al cerrar hay que soltarlo, o el bloqueo sobrevive al proceso. */
function soltar() {
  activar(false);
}

module.exports = { activar, activo, soltar };
