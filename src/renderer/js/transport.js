/**
 * Barra de transporte: lo que se esta viendo, los mandos y la posicion.
 *
 * La barra de posicion no se mueve con los eventos del elemento de video:
 * 'timeupdate' llega unas cuatro veces por segundo y a ese ritmo la barra
 * avanza a tirones. Se pinta con requestAnimationFrame mientras corre, y los
 * eventos solo sirven para corregir despues de un salto o una pausa.
 */

import { $, glifo, pintarGlifo, pintarSvg, formatoTiempo } from './dom.js';
import { crearBarra } from './barra.js';
import { abrirMenu } from './menu.js';
import { PASO_RETARDO } from './subtitulos.js';

export function initTransporte(motor, opciones = {}) {
  const { player, queue } = motor;
  const { escenario, subtitulos } = opciones;

  // La miniatura y el boton de volver al video son el mismo elemento: se
  // pulsa lo que se quiere recuperar. Ver la nota en transport.css.
  const arte = $('#btn-al-video');
  const volverAlVideo = arte;
  const imagen = $('#ahora-imagen');
  const titulo = $('#ahora-titulo');
  const detalle = $('#ahora-detalle');

  const btnAnterior = $('#btn-anterior');
  const btnReproducir = $('#btn-reproducir');
  const btnSiguiente = $('#btn-siguiente');
  const btnAleatorio = $('#btn-aleatorio');
  const btnRepetir = $('#btn-repetir');
  const btnSilencio = $('#btn-silencio');
  const btnSubtitulos = $('#btn-subtitulos');
  const btnMini = $('#btn-mini');
  const btnPantalla = $('#btn-pantalla');

  const relojActual = $('#reloj-actual');
  const relojTotal = $('#reloj-total');
  const globo = $('#globo-tiempo');

  pintarGlifo(btnAnterior, 'anterior');
  pintarGlifo(btnReproducir, 'reproducir');
  pintarGlifo(btnSiguiente, 'siguiente');
  pintarGlifo(btnAleatorio, 'aleatorio');
  pintarGlifo(btnPantalla, 'aPantalla');
  pintarSvg(btnMini, 'mini');
  pintarSvg(btnSubtitulos, 'subtitulos');

  // --- Posicion -------------------------------------------------------------

  const barraTiempo = crearBarra($('#barra-tiempo'), {
    onPreview: (v) => {
      const dur = player.duration;
      if (globo) globo.textContent = formatoTiempo(v * dur);
    },
    onCambio: (v) => {
      // Durante el arrastre solo se mueve el reloj: saltar en cada pixel
      // dispara una peticion de rango por fotograma y el video se atasca.
      if (relojActual) relojActual.textContent = formatoTiempo(v * player.duration);
    },
    onSoltar: (v) => player.seek(v * player.duration),
  });

  const barraVolumen = crearBarra($('#barra-volumen'), {
    directo: true,
    paso: 0.05,
    onCambio: (v) => {
      motor.setVolume(v);
      if (player.muted) motor.setMuted(false);
      pintarVolumen();
    },
  });

  // --- Pintado --------------------------------------------------------------

  function pintarVideo(track) {
    const hay = !!track;
    titulo.textContent = hay ? track.title : 'Nada abierto';
    detalle.textContent = hay ? descripcion(track) : 'Elige un video y dale al play';
    volverAlVideo.disabled = !hay;

    if (hay && track.thumbUrl) {
      imagen.src = track.thumbUrl;
      imagen.alt = '';
      arte.dataset.conArte = 'true';
      imagen.hidden = false;
    } else {
      imagen.removeAttribute('src');
      imagen.hidden = true;
      delete arte.dataset.conArte;
    }

    barraTiempo.setDesactivada(!hay);
    barraTiempo.setValor(0);
    barraTiempo.setBuffer(0);
    relojActual.textContent = '0:00';
    relojTotal.textContent = formatoTiempo(hay ? track.duration : 0);
  }

  function pintarEstado(reproduciendo) {
    pintarGlifo(btnReproducir, reproduciendo ? 'pausa' : 'reproducir');
    const etiqueta = reproduciendo ? 'Pausar' : 'Reproducir';
    btnReproducir.title = etiqueta;
    btnReproducir.setAttribute('aria-label', etiqueta);
  }

  function pintarVolumen() {
    const v = player.muted ? 0 : player.volume;
    barraVolumen.setValor(v);
    const nombre = player.muted ? 'silencio'
      : v === 0 ? 'volumen0'
        : v < 0.34 ? 'volumen1'
          : v < 0.67 ? 'volumen2' : 'volumen3';
    pintarGlifo(btnSilencio, nombre);
    btnSilencio.setAttribute('aria-pressed', String(!!player.muted));
    btnSilencio.title = player.muted ? 'Quitar el silencio' : 'Silenciar';
    barraVolumen.setAria(`${Math.round(v * 100)}%`, v * 100, 100);
  }

  function pintarModos() {
    btnAleatorio.setAttribute('aria-pressed', String(queue.shuffle));
    btnAleatorio.title = queue.shuffle ? 'Aleatorio: activado' : 'Aleatorio: desactivado';

    pintarGlifo(btnRepetir, queue.repeat === 'one' ? 'repetirUna' : 'repetirTodo');
    btnRepetir.setAttribute('aria-pressed', String(queue.repeat !== 'off'));
    btnRepetir.title = queue.repeat === 'off' ? 'Repetir: desactivado'
      : queue.repeat === 'all' ? 'Repetir: toda la cola' : 'Repetir: este video';
  }

  function pintarTiempo() {
    const dur = player.duration;
    const actual = player.currentTime;
    if (dur > 0) {
      barraTiempo.setValor(actual / dur);
      barraTiempo.setBuffer(player.buffered / dur);
      barraTiempo.setAria(`${formatoTiempo(actual)} de ${formatoTiempo(dur)}`, actual, dur);
    }
    if (!barraTiempo.arrastrando) relojActual.textContent = formatoTiempo(actual);
    relojTotal.textContent = formatoTiempo(dur);
  }

  // --- Bucle de refresco ----------------------------------------------------

  let bucle = 0;
  function arrancarBucle() {
    if (bucle) return;
    const paso = () => {
      pintarTiempo();
      bucle = player.playing ? requestAnimationFrame(paso) : 0;
    };
    bucle = requestAnimationFrame(paso);
  }

  function pararBucle() {
    if (bucle) cancelAnimationFrame(bucle);
    bucle = 0;
    pintarTiempo();
  }

  // --- Cableado -------------------------------------------------------------

  btnReproducir.addEventListener('click', () => {
    // Sin nada cargado, el boton de play arranca la cola por el principio en
    // vez de no hacer nada, que es lo que la gente espera.
    if (!player.track && queue.length) queue.playAt(Math.max(0, queue.index));
    else player.toggle();
  });
  btnAnterior.addEventListener('click', () => queue.prev());
  btnSiguiente.addEventListener('click', () => queue.next());
  btnAleatorio.addEventListener('click', () => queue.toggleShuffle());
  btnRepetir.addEventListener('click', () => queue.cycleRepeat());
  btnSilencio.addEventListener('click', () => {
    motor.toggleMute();
    pintarVolumen();
  });

  // La ficha de la izquierda es la vuelta al video: se puede seguir viendo
  // algo mientras se busca otra cosa en la biblioteca, y sin esto la unica
  // forma de volver a la imagen seria abrirlo otra vez desde la lista.
  volverAlVideo.addEventListener('click', () => escenario?.mostrar());

  btnMini.addEventListener('click', () => {
    const mini = document.documentElement.dataset.mini !== 'true';
    window.reele.window.setMini(mini);
  });

  btnPantalla.addEventListener('click', () => window.reele.window.togglePantalla());

  // --- Subtitulos -----------------------------------------------------------

  function pintarSubtitulos() {
    const estado = subtitulos?.estado();
    const activos = !!estado?.activaId && estado.encendidos;
    btnSubtitulos.setAttribute('aria-pressed', String(activos));
    btnSubtitulos.disabled = !player.track;
    btnSubtitulos.title = !estado?.hay
      ? 'Subtitulos: no hay ninguno junto a este video'
      : activos ? 'Subtitulos: puestos' : 'Subtitulos: quitados';
  }

  btnSubtitulos.addEventListener('click', () => {
    const estado = subtitulos?.estado();
    if (!estado) return;

    const items = [];

    if (!estado.hay) {
      /*
       * Merece la pena explicarlo en vez de dejar el menu vacio.
       *
       * Chromium decodifica los subtitulos incrustados en un MKV pero no los
       * publica en `textTracks`, asi que desde la pagina no hay forma de
       * enumerarlos ni de encenderlos. Sin este aviso, quien sabe que su
       * archivo lleva subtitulos dentro da por hecho que la aplicacion esta
       * rota.
       */
      items.push({ texto: 'No hay archivos de subtitulos junto a este video', desactivado: true });
      items.push({ texto: 'Los incrustados en el archivo no se pueden leer', desactivado: true });
    } else {
      items.push({
        texto: 'Sin subtitulos',
        marcado: !estado.activaId || !estado.encendidos,
        onElegir: () => (estado.activaId ? subtitulos.setEncendidos(false) : null),
      });
      for (const pista of estado.pistas) {
        items.push({
          texto: pista.etiqueta,
          detalle: pista.formato.toUpperCase(),
          marcado: estado.activaId === pista.id && estado.encendidos,
          onElegir: () => subtitulos.elegir(pista.id),
        });
      }
      items.push({ separador: true });
      items.push({
        texto: 'Adelantar los subtitulos',
        detalle: `${estado.retardo > 0 ? '+' : ''}${estado.retardo} ms`,
        desactivado: !estado.activaId,
        onElegir: () => subtitulos.ajustarRetardo(-PASO_RETARDO),
      });
      items.push({
        texto: 'Atrasar los subtitulos',
        desactivado: !estado.activaId,
        onElegir: () => subtitulos.ajustarRetardo(PASO_RETARDO),
      });
      if (estado.retardo) {
        items.push({
          texto: 'Quitar el retardo',
          onElegir: () => subtitulos.setRetardo(0),
        });
      }
    }

    abrirMenu({ items, ancla: btnSubtitulos, titulo: 'Subtitulos' });
  });

  subtitulos?.onCambio(pintarSubtitulos);

  window.reele.window.onMini(({ mini }) => {
    btnMini.setAttribute('aria-pressed', String(mini));
    btnMini.title = mini ? 'Volver a la ventana completa' : 'Mini reproductor';
  });

  window.reele.window.onPantalla(({ pantalla }) => {
    pintarGlifo(btnPantalla, pantalla ? 'aVentana' : 'aPantalla');
    btnPantalla.title = pantalla ? 'Salir de pantalla completa' : 'Pantalla completa';
    btnPantalla.setAttribute('aria-label', btnPantalla.title);
  });

  player.on('state', ({ playing }) => {
    pintarEstado(playing);
    if (playing) arrancarBucle();
    else pararBucle();
  });

  player.on('trackchange', ({ track }) => {
    pintarVideo(track);
    pintarSubtitulos();
  });
  player.on('duration', () => pintarTiempo());
  player.on('metadatos', ({ track }) => {
    // Al llegar los metadatos ya se conoce la resolucion real, que puede no
    // ser la que la biblioteca tenia apuntada.
    if (track === player.track) detalle.textContent = descripcion(track, player.video);
  });
  player.on('time', () => {
    if (!bucle) pintarTiempo();
  });

  player.on('volumen', pintarVolumen);
  queue.on('mode', pintarModos);

  pintarVideo(null);
  pintarEstado(false);
  pintarVolumen();
  pintarModos();
  pintarSubtitulos();

  return { pintarVideo, pintarVolumen, pintarModos, pintarSubtitulos };
}

/** La segunda linea: episodio, ano, resolucion y carpeta. */
function descripcion(track, video) {
  const partes = [];
  if (track.season || track.episode) {
    const s = String(track.season ?? 1).padStart(2, '0');
    const e = String(track.episode ?? 1).padStart(2, '0');
    partes.push(`S${s}E${e}`);
  }
  if (track.year) partes.push(String(track.year));
  const alto = video?.videoHeight || track.height;
  if (alto) partes.push(`${alto}p`);
  if (track.folder) partes.push(track.folder);
  return partes.join(' · ') || track.fileName || '';
}
