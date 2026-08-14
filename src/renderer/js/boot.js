/**
 * Arranque del renderer: ajustes al DOM, motor de video y estructura.
 */

import { initTitlebar } from './titlebar.js';
import { crearMotor } from './engine.js';
import { crearEscenario } from './escenario.js';
import { initTransporte } from './transport.js';
import { initShell } from './shell.js';
import { $, pintarGlifo } from './dom.js';

const raiz = document.documentElement;

boot();

async function boot() {
  initTitlebar();

  const ajustes = await window.reele.settings.all();
  aplicarAjustes(ajustes);

  // Windows apaga el acrilico del sistema al perder el foco. La UI compensa
  // subiendo su propia veladura; sin esto el contraste se cae y parece que
  // el tema se rompio.
  window.reele.window.onFocus(({ focused }) => {
    raiz.dataset.focused = String(focused);
  });

  window.reele.window.onMini(({ mini }) => {
    raiz.dataset.mini = String(mini);
  });

  window.reele.window.onPantalla(({ pantalla }) => {
    raiz.dataset.pantalla = String(pantalla);
  });

  window.reele.settings.onChange((patch) => aplicarAjustes(patch));

  const motor = crearMotor($('#video'), ajustes);
  const escenario = crearEscenario(motor.player, {
    ajustes,
    onVolumen: (v) => motor.setVolume(v),
  });
  initTransporte(motor, { escenario });
  const shell = initShell(motor, ajustes);

  engancharTitulo(motor);
  engancharApertura(motor);

  await shell.refrescar();
  return { motor, escenario, shell };
}

/**
 * El titulo de la ventana y el del centro de la barra.
 *
 * Se pone lo que se esta viendo y no el nombre de la app: en la barra de
 * tareas, con tres ventanas abiertas, "Reele" tres veces no distingue nada.
 */
function engancharTitulo(motor) {
  const centro = $('#titulo-ahora');
  motor.queue.on('track', ({ track }) => pintar(track));
  motor.player.on('trackchange', ({ track }) => pintar(track));

  function pintar(track) {
    centro.textContent = track ? track.title : 'Reele';
    document.title = track ? `${track.title} · Reele` : 'Reele';
  }
}

/**
 * Las tres formas de abrir algo: el boton, soltar en la ventana y el doble
 * clic del Explorador.
 *
 * Las tres acaban en el mismo sitio, `queue.setContext`, porque las tres
 * significan lo mismo: esto es lo que quiero ver ahora, y esta es la cola.
 */
function engancharApertura(motor) {
  const boton = $('#btn-abrir-archivos');

  boton?.addEventListener('click', async () => {
    const videos = await window.reele.library.openFiles();
    if (videos?.length) motor.queue.setContext(videos, { startIndex: 0 });
  });

  window.reele.app.onOpenFiles((videos) => {
    if (videos?.length) motor.queue.setContext(videos, { startIndex: 0 });
  });

  engancharSoltar(motor);
}

/**
 * Arrastrar y soltar sobre la ventana.
 *
 * El contador de profundidad no es un capricho: 'dragleave' salta tambien al
 * pasar de un elemento a otro DENTRO de la ventana, asi que con una simple
 * bandera la capa de "suelta aqui" parpadea todo el rato mientras se mueve
 * el raton por encima.
 */
function engancharSoltar(motor) {
  pintarGlifo($('#soltar-icono'), 'abrir');
  let profundidad = 0;

  const apagar = () => {
    profundidad = 0;
    delete raiz.dataset.soltando;
  };

  window.addEventListener('dragenter', (e) => {
    if (!traeArchivos(e)) return;
    profundidad++;
    raiz.dataset.soltando = 'true';
  });

  window.addEventListener('dragover', (e) => {
    if (!traeArchivos(e)) return;
    // Sin preventDefault, Chromium navega a la ruta del archivo soltado y la
    // aplicacion desaparece sustituida por un visor de video pelado.
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  window.addEventListener('dragleave', () => {
    profundidad = Math.max(0, profundidad - 1);
    if (!profundidad) apagar();
  });

  window.addEventListener('drop', async (e) => {
    if (!traeArchivos(e)) return;
    e.preventDefault();
    apagar();

    const rutas = window.reele.library.pathsFromDrop(e.dataTransfer.files);
    if (!rutas.length) return;
    const videos = await window.reele.library.addPaths(rutas);
    if (videos?.length) motor.queue.setContext(videos, { startIndex: 0 });
  });
}

function traeArchivos(evento) {
  return [...(evento.dataTransfer?.types ?? [])].includes('Files');
}

export function aplicarAjustes(ajustes) {
  if (!ajustes) return;

  if (ajustes.backdrop !== undefined) raiz.dataset.backdrop = ajustes.backdrop;
  if (ajustes.miniPlayer !== undefined) raiz.dataset.mini = String(ajustes.miniPlayer);
  if (ajustes.sidebarCollapsed !== undefined) {
    raiz.dataset.lateral = ajustes.sidebarCollapsed ? 'plegado' : 'abierto';
  }
  if (ajustes.glassOpacity !== undefined) {
    raiz.style.setProperty('--transparencia', String(ajustes.glassOpacity));
  }
  // Con el color adaptativo encendido manda el fotograma de portada: escribir
  // aqui el tinte o el acento guardados los pisaria a media transicion y el
  // vidrio daria un salto de color en mitad de la pelicula.
  if (ajustes.adaptiveColor !== undefined) adaptativo = !!ajustes.adaptiveColor;

  if (ajustes.backdropTint !== undefined && !adaptativo) {
    raiz.style.setProperty('--tinte', hexARgb(ajustes.backdropTint));
  }
  if (ajustes.accentFallback !== undefined && !adaptativo) {
    raiz.style.setProperty('--acento', hexARgb(ajustes.accentFallback));
  }
}

let adaptativo = true;

/** '#A78BFA' -> '167 139 250', que es el formato que quieren las variables. */
export function hexARgb(hex) {
  const h = String(hex).replace('#', '').trim();
  if (h.length !== 6) return '167 139 250';
  const n = Number.parseInt(h, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}
