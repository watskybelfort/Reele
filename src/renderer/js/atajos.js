/**
 * Atajos de teclado.
 *
 * En un reproductor de video son la mitad de la interfaz: viendo algo a
 * pantalla completa el raton no esta en la mano, y quien ve series maneja
 * todo con la barra espaciadora y las flechas sin mirar.
 *
 * La lista se define aqui una sola vez y de ella salen las dos cosas: lo que
 * se ejecuta al pulsar y lo que se ensena en Ajustes. Con dos listas
 * separadas, la de la pantalla acaba mintiendo — siempre se cambia una tecla
 * y se olvida la otra.
 */

/** Salto corto de las flechas, en segundos. */
const SALTO = 10;
/** Salto largo, con Shift. Un bloque de anuncios o una cabecera. */
const SALTO_LARGO = 60;

export function crearAtajos({ motor, escenario, subtitulos }) {
  const { player, queue } = motor;

  const acciones = [
    {
      id: 'reproducir',
      texto: 'Reproducir o pausar',
      atajo: 'Espacio  ·  K',
      teclas: [' ', 'k'],
      hacer: () => {
        if (!player.track && queue.length) queue.playAt(Math.max(0, queue.index));
        else {
          const sonando = player.toggle();
          escenario.latido(sonando ? 'reproducir' : 'pausa');
        }
      },
    },
    {
      id: 'atras',
      texto: `Retroceder ${SALTO} segundos`,
      atajo: 'Flecha izquierda  ·  J',
      teclas: ['arrowleft', 'j'],
      hacer: () => player.saltar(-SALTO),
    },
    {
      id: 'adelante',
      texto: `Adelantar ${SALTO} segundos`,
      atajo: 'Flecha derecha  ·  L',
      teclas: ['arrowright', 'l'],
      hacer: () => player.saltar(SALTO),
    },
    {
      id: 'atras-largo',
      texto: `Retroceder ${SALTO_LARGO} segundos`,
      atajo: 'Shift + Flecha izquierda',
      teclas: ['arrowleft'],
      shift: true,
      hacer: () => player.saltar(-SALTO_LARGO),
    },
    {
      id: 'adelante-largo',
      texto: `Adelantar ${SALTO_LARGO} segundos`,
      atajo: 'Shift + Flecha derecha',
      teclas: ['arrowright'],
      shift: true,
      hacer: () => player.saltar(SALTO_LARGO),
    },
    {
      id: 'subir',
      texto: 'Subir el volumen',
      atajo: 'Flecha arriba',
      teclas: ['arrowup'],
      hacer: () => motor.setVolume(player.volume + 0.05),
    },
    {
      id: 'bajar',
      texto: 'Bajar el volumen',
      atajo: 'Flecha abajo',
      teclas: ['arrowdown'],
      hacer: () => motor.setVolume(player.volume - 0.05),
    },
    {
      id: 'silencio',
      texto: 'Silenciar',
      atajo: 'M',
      teclas: ['m'],
      hacer: () => motor.toggleMute(),
    },
    {
      id: 'pantalla',
      texto: 'Pantalla completa',
      atajo: 'F  ·  F11',
      teclas: ['f', 'f11'],
      hacer: () => window.reele.window.togglePantalla(),
    },
    {
      id: 'mini',
      texto: 'Mini reproductor',
      atajo: 'Ctrl + M',
      teclas: ['m'],
      ctrl: true,
      hacer: () => window.reele.window.setMini(document.documentElement.dataset.mini !== 'true'),
    },
    {
      id: 'siguiente',
      texto: 'Siguiente en la cola',
      atajo: 'N',
      teclas: ['n'],
      hacer: () => queue.next(),
    },
    {
      id: 'anterior',
      texto: 'Anterior en la cola',
      atajo: 'P',
      teclas: ['p'],
      hacer: () => queue.prev(),
    },
    {
      id: 'subtitulos',
      texto: 'Poner o quitar los subtitulos',
      atajo: 'C',
      teclas: ['c'],
      hacer: () => subtitulos.alternar(),
    },
    {
      id: 'subs-antes',
      texto: 'Adelantar los subtitulos',
      atajo: 'G',
      teclas: ['g'],
      hacer: () => subtitulos.ajustarRetardo(-250),
    },
    {
      id: 'subs-despues',
      texto: 'Atrasar los subtitulos',
      atajo: 'H',
      teclas: ['h'],
      hacer: () => subtitulos.ajustarRetardo(250),
    },
    {
      id: 'mas-rapido',
      texto: 'Mas rapido',
      atajo: '+',
      teclas: ['+', '='],
      hacer: () => motor.setRate(siguienteVelocidad(player.rate, 1)),
    },
    {
      id: 'mas-lento',
      texto: 'Mas lento',
      atajo: '-',
      teclas: ['-'],
      hacer: () => motor.setRate(siguienteVelocidad(player.rate, -1)),
    },
    {
      id: 'encaje',
      texto: 'Cambiar el encaje de la imagen',
      atajo: 'E',
      teclas: ['e'],
      hacer: () => escenario.alternarEncaje(),
    },
    {
      id: 'buscar',
      texto: 'Buscar en la biblioteca',
      atajo: 'Ctrl + F',
      teclas: ['f'],
      ctrl: true,
      hacer: () => {
        escenario.ocultar();
        const campo = document.querySelector('#buscador');
        campo?.focus();
        campo?.select();
      },
    },
    {
      id: 'abrir',
      texto: 'Abrir archivos',
      atajo: 'Ctrl + O',
      teclas: ['o'],
      ctrl: true,
      hacer: async () => {
        const videos = await window.reele.library.openFiles();
        if (videos?.length) queue.setContext(videos, { startIndex: 0 });
      },
    },
    {
      id: 'biblioteca',
      texto: 'Volver a la biblioteca',
      atajo: 'Escape',
      teclas: [],
      hacer: () => escenario.ocultar(),
    },
  ];

  const porTecla = new Map();
  for (const accion of acciones) {
    for (const tecla of accion.teclas) {
      porTecla.set(clave(tecla, accion.ctrl, accion.shift), accion);
    }
  }

  document.addEventListener('keydown', (evento) => {
    if (escribiendo(evento.target)) return;
    if (evento.altKey || evento.metaKey) return;

    // Escape tiene tres significados por orden: cerrar lo que flote, salir
    // de pantalla completa, y volver a la biblioteca. Encadenarlos es lo que
    // hace que la tecla siempre "deshaga una capa" en vez de saltar al final.
    if (evento.key === 'Escape') {
      evento.preventDefault();
      if (document.documentElement.dataset.pantalla === 'true') {
        window.reele.window.setPantalla(false);
      } else if (escenario.abierto) {
        escenario.ocultar();
      }
      return;
    }

    // Los numeros saltan a su decima parte del video, como en cualquier
    // reproductor web. El 0 vuelve al principio, no a velocidad normal:
    // manda la costumbre de la barra de progreso.
    if (/^[0-9]$/.test(evento.key) && !evento.ctrlKey) {
      evento.preventDefault();
      const dur = player.duration;
      if (dur > 0) player.seek((Number(evento.key) / 10) * dur);
      escenario.despertar();
      return;
    }

    const accion = porTecla.get(clave(evento.key.toLowerCase(), evento.ctrlKey, evento.shiftKey));
    if (!accion) return;
    evento.preventDefault();
    accion.hacer();
    // Cualquier tecla despierta los mandos: si no, a pantalla completa se
    // sube el volumen y no se ve el mando moverse.
    escenario.despertar();
  });

  return { acciones };
}

function clave(tecla, ctrl, shift) {
  return `${ctrl ? 'ctrl+' : ''}${shift ? 'shift+' : ''}${tecla}`;
}

/**
 * Un campo de texto se queda las teclas.
 *
 * Sin esto, escribir "moscas" en el buscador silencia el sonido, salta el
 * video y cambia la velocidad por el camino.
 */
function escribiendo(destino) {
  if (!destino) return false;
  const etiqueta = destino.tagName;
  return etiqueta === 'INPUT' || etiqueta === 'TEXTAREA' || destino.isContentEditable;
}

/** Sube o baja por los escalones de velocidad, sin salirse de los extremos. */
const ESCALONES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

function siguienteVelocidad(actual, direccion) {
  const i = ESCALONES.findIndex((v) => Math.abs(v - actual) < 0.001);
  if (i < 0) return 1;
  return ESCALONES[Math.min(ESCALONES.length - 1, Math.max(0, i + direccion))];
}
