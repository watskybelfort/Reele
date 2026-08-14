/**
 * Menu emergente.
 *
 * Uno solo a la vez y siempre colgado del body: metido dentro del transporte
 * o del escenario heredaria su `overflow: hidden` y se recortaria contra el
 * borde de la barra, que es donde justamente se abre.
 *
 * Se coloca por CSSOM (`style.setProperty`), no con un atributo style en el
 * marcado: la CSP de la aplicacion no admite estilos en linea.
 */

import { el, glifo } from './dom.js';

let abierto = null;

export function cerrarMenu() {
  if (!abierto) return;
  abierto.nodo.remove();
  abierto.limpiar();
  abierto = null;
}

/**
 * `items` son objetos { texto, icono, marcado, desactivado, onElegir } o
 * { separador: true }. `ancla` es el boton que lo abre: el menu sale encima
 * suyo, que es lo correcto para una barra que vive pegada al borde de abajo.
 */
export function abrirMenu({ items = [], ancla = null, x = 0, y = 0, titulo = null } = {}) {
  cerrarMenu();

  const nodo = el('div', { class: 'menu flotante', role: 'menu' });
  if (titulo) nodo.append(el('div', { class: 'menu__titulo', texto: titulo }));

  for (const item of items) {
    if (item.separador) {
      nodo.append(el('div', { class: 'menu__separador', role: 'separator' }));
      continue;
    }
    const boton = el('button', {
      class: 'menu__item',
      role: 'menuitemradio',
      'aria-checked': String(!!item.marcado),
      disabled: item.desactivado || undefined,
      onClick: () => {
        cerrarMenu();
        item.onElegir?.();
      },
    }, [
      el('span', { class: 'menu__marca', texto: item.marcado ? glifo('reproducir') : '' }),
      el('span', { class: 'menu__texto', texto: item.texto }),
      item.detalle ? el('span', { class: 'menu__detalle', texto: item.detalle }) : null,
    ]);
    nodo.append(boton);
  }

  document.body.append(nodo);
  colocar(nodo, ancla, x, y);

  // El cierre se engancha en el siguiente turno: enganchado ya, el mismo
  // clic que acaba de abrir el menu llega hasta aqui y lo cierra al instante.
  const alPulsar = (e) => {
    if (!nodo.contains(e.target)) cerrarMenu();
  };
  const alTeclear = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    cerrarMenu();
  };
  const alRedimensionar = () => cerrarMenu();

  setTimeout(() => {
    document.addEventListener('pointerdown', alPulsar);
    document.addEventListener('keydown', alTeclear, true);
    window.addEventListener('resize', alRedimensionar);
  }, 0);

  abierto = {
    nodo,
    limpiar() {
      document.removeEventListener('pointerdown', alPulsar);
      document.removeEventListener('keydown', alTeclear, true);
      window.removeEventListener('resize', alRedimensionar);
      ancla?.setAttribute('aria-expanded', 'false');
    },
  };

  ancla?.setAttribute('aria-expanded', 'true');
  nodo.querySelector('.menu__item:not([disabled])')?.focus();
  return abierto;
}

/**
 * Coloca el menu sin que se salga de la ventana.
 *
 * Con ancla sale encima del boton y alineado a su derecha, porque todos los
 * botones que abren menus viven en la esquina de abajo a la derecha. Sin
 * ancla —menu contextual— sale donde este el cursor.
 */
function colocar(nodo, ancla, x, y) {
  const margen = 8;
  const caja = nodo.getBoundingClientRect();
  let izquierda;
  let arriba;

  if (ancla) {
    const a = ancla.getBoundingClientRect();
    izquierda = a.right - caja.width;
    arriba = a.top - caja.height - 6;
    // Si arriba no cabe, se pone debajo del boton en vez de recortarse.
    if (arriba < margen) arriba = a.bottom + 6;
  } else {
    izquierda = x;
    arriba = y;
    if (arriba + caja.height > window.innerHeight - margen) arriba = y - caja.height;
  }

  izquierda = Math.min(Math.max(margen, izquierda), window.innerWidth - caja.width - margen);
  arriba = Math.min(Math.max(margen, arriba), window.innerHeight - caja.height - margen);

  nodo.style.setProperty('left', `${Math.round(izquierda)}px`);
  nodo.style.setProperty('top', `${Math.round(arriba)}px`);
}

export function hayMenuAbierto() {
  return !!abierto;
}
