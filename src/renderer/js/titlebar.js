/**
 * Barra de titulo propia.
 *
 * La ventana va sin marco, asi que minimizar, maximizar y cerrar los tiene
 * que dibujar y cablear la pagina. El arrastre lo resuelve
 * `-webkit-app-region: drag` desde el CSS.
 */

import { $ } from './dom.js';

/** ChromeMaximize y ChromeRestore de Segoe. */
const MAXIMIZAR = 0xe922;
const RESTAURAR = 0xe923;

export function initTitlebar() {
  const maximizar = $('#btn-maximizar');

  $('#btn-minimizar').addEventListener('click', () => window.reele.window.minimize());
  $('#btn-cerrar').addEventListener('click', () => window.reele.window.close());
  maximizar.addEventListener('click', () => window.reele.window.toggleMaximize());
  $('#btn-salir-mini').addEventListener('click', () => window.reele.window.setMini(false));

  /**
   * El glifo de maximizar y el de restaurar son distintos, y el estado puede
   * cambiar sin pasar por el boton: doble clic en la barra, Win+flecha o
   * arrastrar la ventana al borde. Por eso se pinta desde el aviso de la
   * ventana y no desde el clic.
   *
   * Los glifos van por codigo y no pegados en el fuente: viven en el area
   * privada de Unicode y cualquier paso por un editor que reinterprete la
   * codificacion los deja en interrogantes sin avisar.
   */
  const pintar = (maximizado) => {
    maximizar.textContent = String.fromCharCode(maximizado ? RESTAURAR : MAXIMIZAR);
    const etiqueta = maximizado ? 'Restaurar' : 'Maximizar';
    maximizar.title = etiqueta;
    maximizar.setAttribute('aria-label', etiqueta);
  };

  window.reele.window.onState(({ maximized }) => pintar(maximized));
  window.reele.window.getState().then((estado) => {
    if (estado) pintar(estado.maximized);
  });

  return { pintar };
}
