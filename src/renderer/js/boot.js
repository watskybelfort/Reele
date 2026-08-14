/**
 * Arranque del renderer: ajustes al DOM y estructura.
 */

import { initTitlebar } from './titlebar.js';

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
