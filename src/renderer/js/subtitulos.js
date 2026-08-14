/**
 * Subtitulos: eleccion, retardo y pintado.
 *
 * Se pintan a mano, en un div sobre la imagen, en vez de con el <track>
 * nativo del navegador. Cuesta unas cuantas lineas mas y a cambio da las
 * tres cosas que un reproductor de video necesita y el renderizado nativo no
 * deja:
 *
 *   - Retardo ajustable en caliente. Con <track> habria que reconstruir la
 *     pista entera en cada pulsacion de la flecha.
 *   - Tamano de letra a gusto del usuario. `::cue` acepta muy poco y lo que
 *     acepta no se comporta igual dentro y fuera de pantalla completa.
 *   - Subirlos cuando aparecen los mandos, para que la barra de posicion no
 *     tape justo la linea que se estaba leyendo.
 */

import { $ } from './dom.js';

/** Cuanto mueve cada pulsacion del ajuste de retardo. */
export const PASO_RETARDO = 250;

export function crearSubtitulos(player, opciones = {}) {
  const capa = $('#escenario-subs');
  const escenario = $('#escenario');

  let pistas = [];
  let activaId = null;
  let cues = [];
  let indice = -1;
  /** Milisegundos: positivo = los subtitulos van despues. */
  let retardo = 0;
  let encendidos = opciones.ajustes?.subtitlesEnabled !== false;
  let idiomaPreferido = (opciones.ajustes?.subtitleLanguage ?? '').toLowerCase();
  let bucle = 0;
  const alCambiar = new Set();

  setTamano(opciones.ajustes?.subtitleSize ?? 100);

  /**
   * El tamano base de la letra sale de medir el escenario.
   *
   * En `vh` saldria enorme en ventana pequena, porque el video ocupa un
   * tercio de la altura de la pantalla pero vh sigue siendo la pantalla
   * entera; y en `em` no crecerian al pasar a pantalla completa. Midiendo el
   * escenario, los subtitulos ocupan lo mismo respecto a la imagen en los
   * tres modos, que es lo unico que se percibe como correcto.
   */
  function medir() {
    const alto = escenario.clientHeight || 0;
    const base = Math.min(46, Math.max(14, alto * 0.045));
    escenario.style.setProperty('--subs-base', `${base.toFixed(1)}px`);
  }

  new ResizeObserver(medir).observe(escenario);
  medir();

  // --- Pintado --------------------------------------------------------------

  function pintarCue(cue) {
    if (!cue) {
      if (capa.textContent) capa.replaceChildren();
      capa.hidden = true;
      return;
    }
    capa.hidden = false;
    // Cada linea en su propio elemento: un solo nodo de texto con saltos
    // dejaria el fondo pintado como un unico bloque rectangular del ancho de
    // la linea mas larga, en vez de ajustarse a cada una.
    capa.replaceChildren(...cue.text.split('\n').map((linea) => {
      const p = document.createElement('span');
      p.className = 'subs__linea';
      p.textContent = linea;
      return p;
    }));
  }

  /**
   * Busca el cue que toca.
   *
   * Con el puntero anterior a mano casi siempre es mirar uno o dos; solo tras
   * un salto grande hay que recorrer. En un archivo con dos mil lineas, hacer
   * un `find` completo en cada fotograma serian dos millones de
   * comparaciones por segundo para no cambiar nada.
   */
  function buscarCue(t) {
    if (!cues.length) return -1;

    if (indice >= 0 && indice < cues.length) {
      const actual = cues[indice];
      if (t >= actual.start && t < actual.end) return indice;
      // Un paso adelante cubre el caso normal: la linea siguiente.
      const siguiente = cues[indice + 1];
      if (siguiente && t >= siguiente.start && t < siguiente.end) return indice + 1;
    }

    // Busqueda binaria del ultimo cue que ya ha empezado.
    let bajo = 0;
    let alto = cues.length - 1;
    let encontrado = -1;
    while (bajo <= alto) {
      const medio = (bajo + alto) >> 1;
      if (cues[medio].start <= t) {
        encontrado = medio;
        bajo = medio + 1;
      } else {
        alto = medio - 1;
      }
    }
    if (encontrado >= 0 && t < cues[encontrado].end) return encontrado;
    return -1;
  }

  function refrescar() {
    if (!encendidos || !cues.length) {
      pintarCue(null);
      return;
    }
    const t = player.currentTime - retardo / 1000;
    const i = buscarCue(t);
    if (i === indice) return;
    indice = i;
    pintarCue(i >= 0 ? cues[i] : null);
  }

  function arrancarBucle() {
    if (bucle) return;
    const paso = () => {
      refrescar();
      bucle = player.playing ? requestAnimationFrame(paso) : 0;
    };
    bucle = requestAnimationFrame(paso);
  }

  function pararBucle() {
    if (bucle) cancelAnimationFrame(bucle);
    bucle = 0;
    // Un refresco mas al parar: si la pausa cae justo en un cambio de linea,
    // sin esto se queda en pantalla la anterior hasta que se vuelva a dar al
    // play.
    indice = -1;
    refrescar();
  }

  player.on('state', ({ playing }) => {
    if (playing) arrancarBucle();
    else pararBucle();
  });

  // Tras un salto el puntero ya no vale: se fuerza la busqueda entera.
  player.on('time', () => {
    if (!bucle) {
      indice = -1;
      refrescar();
    }
  });

  // --- Pistas ---------------------------------------------------------------

  async function cargarPara(track) {
    pistas = [];
    activaId = null;
    cues = [];
    indice = -1;
    retardo = 0;
    pintarCue(null);
    marcar();

    if (!track?.id) return pistas;

    pistas = await window.reele.subtitulos.para(track.id);
    marcar();

    // Se enciende sola la del idioma preferido. Si no hay ninguna en ese
    // idioma NO se pone otra cualquiera: unos subtitulos en un idioma que no
    // entiendes tapan la imagen sin dar nada a cambio.
    const preferida = elegirAutomatica(pistas, idiomaPreferido);
    if (preferida && encendidos) await elegir(preferida.id);
    return pistas;
  }

  async function elegir(id) {
    if (!id) {
      activaId = null;
      cues = [];
      indice = -1;
      pintarCue(null);
      marcar();
      return null;
    }

    const track = player.track;
    if (!track) return null;
    const res = await window.reele.subtitulos.leer(track.id, id);
    if (!res?.ok || !res.cues.length) {
      activaId = null;
      cues = [];
      pintarCue(null);
      marcar();
      return null;
    }

    activaId = id;
    cues = res.cues;
    indice = -1;
    encendidos = true;
    refrescar();
    marcar();
    return activaId;
  }

  function marcar() {
    escenario.dataset.subtitulos = String(!!activaId && encendidos);
    for (const fn of alCambiar) fn(estado());
  }

  function estado() {
    return {
      pistas,
      activaId,
      encendidos,
      retardo,
      hay: pistas.length > 0,
    };
  }

  // --- Ajustes --------------------------------------------------------------

  function setEncendidos(valor) {
    encendidos = !!valor;
    window.reele.settings.set({ subtitlesEnabled: encendidos });
    indice = -1;
    refrescar();
    marcar();
    return encendidos;
  }

  function alternar() {
    // Sin pista elegida, encender significa poner la primera: si no, el boton
    // parece que no hace nada.
    if (!activaId && pistas.length) {
      elegir(pistas[0].id);
      return true;
    }
    return setEncendidos(!encendidos);
  }

  function setRetardo(ms) {
    retardo = Math.round(Number(ms) || 0);
    indice = -1;
    refrescar();
    marcar();
    return retardo;
  }

  function setTamano(porcentaje) {
    const valor = Math.min(220, Math.max(60, Number(porcentaje) || 100));
    document.documentElement.style.setProperty('--subs-escala', String(valor / 100));
    return valor;
  }

  window.reele.settings.onChange((patch) => {
    if (patch.subtitleSize !== undefined) setTamano(patch.subtitleSize);
    if (patch.subtitleLanguage !== undefined) idiomaPreferido = String(patch.subtitleLanguage).toLowerCase();
  });

  player.on('trackchange', ({ track }) => cargarPara(track));

  return {
    get pistas() { return pistas; },
    get activaId() { return activaId; },
    get encendidos() { return encendidos; },
    get retardo() { return retardo; },
    estado,
    elegir,
    alternar,
    setEncendidos,
    setRetardo,
    ajustarRetardo(delta) { return setRetardo(retardo + delta); },
    setTamano,
    onCambio(fn) {
      alCambiar.add(fn);
      return () => alCambiar.delete(fn);
    },
  };
}

/**
 * Cual se enciende sola.
 *
 * Manda el idioma preferido, y dentro de el las pistas normales antes que las
 * forzadas: los subtitulos forzados solo traducen los carteles y las frases
 * en otro idioma, asi que quien los recibe sin pedirlos cree que el archivo
 * viene con los subtitulos incompletos.
 *
 * Con VARIAS pistas y ninguna del idioma preferido no se pone ninguna: unos
 * subtitulos en un idioma que no entiendes tapan la imagen sin dar nada a
 * cambio. Pero si solo hay UNA y no dice de que idioma es —el caso corriente
 * de "pelicula.mkv" con "pelicula.srt" al lado— se enciende: quien deja un
 * unico archivo de subtitulos junto al video es porque quiere verlo, y
 * obligarle a abrir el menu cada vez seria absurdo.
 */
function elegirAutomatica(pistas, idiomaPreferido) {
  if (!pistas.length) return null;

  if (pistas.length === 1 && !pistas[0].idioma) return pistas[0];
  if (!idiomaPreferido) return null;

  const delIdioma = pistas.filter((p) => coincideIdioma(p, idiomaPreferido));
  if (!delIdioma.length) return null;
  return delIdioma.find((p) => !/forzados/i.test(p.etiqueta)) ?? delIdioma[0];
}

function coincideIdioma(pista, preferido) {
  if (!pista.idioma) return false;
  const nombre = pista.idioma.toLowerCase();
  if (preferido === 'es') return nombre.startsWith('espanol');
  if (preferido === 'en') return nombre.startsWith('ingles');
  return nombre.startsWith(preferido);
}
