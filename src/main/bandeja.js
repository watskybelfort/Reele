'use strict';

const { Tray, Menu } = require('electron');

const { marca } = require('./iconos');

/**
 * Bandeja del sistema.
 *
 * Apagada por defecto, porque cambia una cosa que la gente da por sabida: con
 * la bandeja puesta, la X de la ventana esconde en vez de cerrar.
 *
 * En un reproductor de video tiene menos sentido que en uno de musica —nadie
 * ve una pelicula con la ventana cerrada— pero si lo tiene para no perder la
 * cola y la posicion al quitar de en medio la ventana un rato. Por eso esta,
 * y por eso viene apagada.
 *
 * Salir de verdad se hace desde el menu de la bandeja.
 */

let bandeja = null;
let ctx = null;
let ultimo = { titulo: null, detalle: null, viendo: false, hayVideo: false };

function activa() {
  return !!bandeja;
}

/**
 * Enciende o apaga la bandeja segun el ajuste.
 * `contexto` lleva { getWindow, mandar, salir }.
 */
function sincronizar(encendida, contexto) {
  ctx = contexto || ctx;
  if (encendida && !bandeja) crear();
  else if (!encendida && bandeja) destruir();
  return activa();
}

function crear() {
  bandeja = new Tray(marca());
  bandeja.setToolTip('Reele');

  // Un clic normal la trae y la esconde otra vez, que es lo que hace todo el
  // mundo con el icono de la bandeja sin pensarlo.
  bandeja.on('click', alternarVentana);
  bandeja.on('double-click', mostrarVentana);

  pintarMenu();
}

function destruir() {
  if (!bandeja) return;
  bandeja.destroy();
  bandeja = null;
}

/** `track` es el video de la biblioteca, o null. */
function actualizar({ track, viendo, hayVideo } = {}) {
  const nuevo = {
    titulo: track?.title ?? null,
    detalle: track?.folder ?? null,
    viendo: !!viendo,
    hayVideo: !!hayVideo,
  };
  const igual = Object.keys(nuevo).every((k) => nuevo[k] === ultimo[k]);
  if (igual) return;
  ultimo = nuevo;
  if (!bandeja) return;

  bandeja.setToolTip(nuevo.titulo
    ? `${nuevo.titulo}${nuevo.detalle ? ` — ${nuevo.detalle}` : ''}`
    : 'Reele');
  // El menu de Electron es inmutable: para que "Reproducir" pase a "Pausar"
  // hay que construirlo otra vez.
  pintarMenu();
}

function pintarMenu() {
  if (!bandeja) return;
  const mandar = (orden) => () => ctx?.mandar?.(orden);

  bandeja.setContextMenu(Menu.buildFromTemplate([
    // Cabecera muerta: dice lo que hay puesto sin obligar a posar el raton
    // encima para leer el tooltip.
    { label: ultimo.titulo || 'Nada abierto', enabled: false },
    { type: 'separator' },
    { label: 'Anterior', enabled: ultimo.hayVideo, click: mandar('prev') },
    {
      label: ultimo.viendo ? 'Pausar' : 'Reproducir',
      enabled: true,
      click: mandar('toggle'),
    },
    { label: 'Siguiente', enabled: ultimo.hayVideo, click: mandar('next') },
    { type: 'separator' },
    { label: 'Mostrar Reele', click: mostrarVentana },
    { label: 'Salir', click: () => ctx?.salir?.() },
  ]));
}

function mostrarVentana() {
  const win = ctx?.getWindow?.();
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function alternarVentana() {
  const win = ctx?.getWindow?.();
  if (!win || win.isDestroyed()) return;
  if (win.isVisible() && !win.isMinimized()) win.hide();
  else mostrarVentana();
}

module.exports = { sincronizar, actualizar, activa, destruir };
