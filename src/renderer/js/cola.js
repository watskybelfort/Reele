/**
 * Panel de la cola.
 *
 * Ensena `queue.items` tal cual, que es el orden real en que se van a ver los
 * videos: con el aleatorio puesto la cola esta barajada de verdad, no
 * traducida por detras, asi que lo que se lee aqui es lo que va a pasar.
 *
 * Reusa la misma lista virtualizada que la biblioteca en modo estrecho. Una
 * lista propia habria sido mas corta de escribir y habria vuelto a pintar mil
 * nodos en cuanto alguien mande la biblioteca entera a la cola.
 */

import { el, glifo, pintarGlifo, plural } from './dom.js';
import { crearLista } from './lista.js';

export function crearCola(motor) {
  const { queue, player } = motor;

  const resumen = el('div', { class: 'cola__resumen' });
  const vaciar = el('button', {
    class: 'icono-btn',
    texto: glifo('papelera'),
    title: 'Vaciar la cola',
    'aria-label': 'Vaciar la cola',
    onClick: () => queue.clear(),
  });

  const lista = crearLista({
    compacta: true,
    conCabecera: false,
    unClic: true,
    altoFila: 54,
    onReproducir: (video, indice) => queue.playAt(indice),
    onQuitar: (video, indice) => queue.removeAt(indice),
    onMover: (desde, hasta) => queue.move(desde, hasta),
  });
  // El orden de la cola no se ordena: ES el orden.
  lista.setOrden('ninguno');

  const vacio = el('div', { class: 'cola__vacio' }, [
    el('span', { class: 'vacio__icono', texto: glifo('cola'), 'aria-hidden': 'true' }),
    el('div', { class: 'vacio__titulo', texto: 'La cola esta vacia' }),
    el('p', { class: 'vacio__texto', texto: 'Abre algo de la biblioteca y la cola sera esa lista.' }),
  ]);

  const nodo = el('aside', { class: 'cola', 'aria-label': 'Cola de reproduccion' }, [
    el('header', { class: 'cola__cabecera' }, [
      el('div', {}, [
        el('h2', { class: 'cola__titulo', texto: 'A continuacion' }),
        resumen,
      ]),
      vaciar,
    ]),
    lista.nodo,
    vacio,
  ]);

  function pintar() {
    const items = queue.items;
    lista.setVideos(items);
    lista.setActual(player.track?.id, player.playing);
    resumen.textContent = items.length
      ? `${plural(items.length, 'video', 'videos')} · ${items.length - queue.index - 1} por delante`
      : 'Nada en la cola';
    nodo.dataset.vacia = String(!items.length);
    vaciar.disabled = !items.length;
  }

  queue.on('change', pintar);
  player.on('trackchange', () => lista.setActual(player.track?.id, player.playing));
  player.on('state', ({ playing }) => lista.setActual(player.track?.id, playing));

  pintar();

  return {
    nodo,
    pintar,
    /** Lleva la vista a lo que se esta viendo ahora mismo. */
    irAActual() {
      const i = queue.index;
      if (i < 0) return;
      const viewport = lista.nodo.querySelector('.lista__viewport');
      if (viewport) viewport.scrollTop = Math.max(0, i * 54 - viewport.clientHeight / 3);
    },
  };
}

/** Engancha el boton del transporte con el panel. */
export function engancharCola(motor, ajustes) {
  const raiz = document.documentElement;
  const cola = crearCola(motor);
  // Va dentro de .app porque ocupa una columna de la rejilla: colgado del
  // body quedaria fuera del reparto y taparia el transporte.
  document.querySelector('.app').append(cola.nodo);

  const boton = document.querySelector('#btn-cola');
  pintarGlifo(boton, 'cola');

  const pintar = (abierta) => {
    raiz.dataset.cola = abierta ? 'abierta' : 'cerrada';
    boton.setAttribute('aria-pressed', String(abierta));
    boton.title = abierta ? 'Ocultar la cola' : 'Cola de reproduccion';
  };

  const alternar = () => {
    const abierta = raiz.dataset.cola !== 'abierta';
    pintar(abierta);
    window.reele.settings.set({ queueOpen: abierta });
    // Al abrirla interesa ver por donde va la reproduccion, no el principio
    // de una cola de dos mil videos.
    if (abierta) requestAnimationFrame(() => cola.irAActual());
    return abierta;
  };

  boton.addEventListener('click', alternar);
  pintar(!!ajustes.queueOpen);

  return { ...cola, alternar };
}
