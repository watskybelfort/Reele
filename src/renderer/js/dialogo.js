/**
 * Dialogos propios en vez de `prompt()` y `confirm()`.
 *
 * Los del navegador bloquean el hilo entero: con un video en marcha, abrir un
 * confirm() congela la imagen hasta que alguien conteste. Ademas salen con el
 * marco gris del sistema en mitad de una ventana de vidrio, y no hay forma de
 * darles el estilo de la aplicacion.
 *
 * Los dos devuelven una promesa: `null` si se cancela.
 */

import { el } from './dom.js';

export function preguntar({ titulo, texto, valor = '', aceptar = 'Guardar', placeholder = '' }) {
  return abrir({ titulo, texto, aceptar, valor, placeholder, conCampo: true });
}

export function confirmar({ titulo, texto, aceptar = 'Aceptar', peligroso = false }) {
  return abrir({ titulo, texto, aceptar, peligroso, conCampo: false });
}

function abrir({ titulo, texto, aceptar, valor, placeholder, conCampo, peligroso }) {
  return new Promise((resolve) => {
    const campo = conCampo
      ? el('input', { class: 'dialogo__campo', type: 'text', value: valor, placeholder, spellcheck: 'false' })
      : null;

    const cerrar = (resultado) => {
      document.removeEventListener('keydown', alTeclear, true);
      velo.remove();
      resolve(resultado);
    };

    const alTeclear = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        // Se para aqui o Escape saldria ademas de pantalla completa por
        // debajo del dialogo que se acaba de cerrar.
        e.stopPropagation();
        cerrar(null);
      }
      if (e.key === 'Enter' && conCampo) {
        e.preventDefault();
        e.stopPropagation();
        cerrar(campo.value.trim() || null);
      }
    };

    const panel = el('div', { class: 'dialogo flotante', role: 'dialog', 'aria-modal': 'true' }, [
      el('h2', { class: 'dialogo__titulo', texto: titulo }),
      texto ? el('p', { class: 'dialogo__texto', texto }) : null,
      campo,
      el('div', { class: 'dialogo__botones' }, [
        el('button', { class: 'boton', texto: 'Cancelar', onClick: () => cerrar(null) }),
        el('button', {
          class: `boton boton--acento${peligroso ? ' boton--peligroso' : ''}`,
          texto: aceptar,
          onClick: () => cerrar(conCampo ? (campo.value.trim() || null) : true),
        }),
      ]),
    ]);

    const velo = el('div', { class: 'dialogo__velo', onClick: (e) => {
      if (e.target === velo) cerrar(null);
    } }, [panel]);

    document.body.append(velo);
    document.addEventListener('keydown', alTeclear, true);
    // El campo con el texto ya seleccionado: renombrar es casi siempre
    // escribir otro nombre entero, no corregir una letra.
    if (campo) {
      campo.focus();
      campo.select();
    } else {
      panel.querySelector('.boton--acento')?.focus();
    }
  });
}
