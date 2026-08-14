/**
 * Pistas de audio.
 *
 * Un MKV descargado trae a menudo castellano e ingles en el mismo archivo, y
 * poder cambiar de una a otra es de las cosas que separan un reproductor de
 * un visor.
 *
 * Esto funciona gracias a la bandera `enable-blink-features=AudioVideoTracks`
 * que pone el proceso principal: Chromium implementa `HTMLMediaElement
 * .audioTracks` pero lo trae apagado de fabrica. Aqui se da por hecho que
 * puede no existir —otra version de Chromium, otro dia— y en ese caso el
 * boton no se ensena, que es mejor que un menu vacio que no explica nada.
 */

/** Nombres bonitos para los codigos de idioma que traen los contenedores. */
const IDIOMAS = {
  spa: 'Espanol', es: 'Espanol', esp: 'Espanol',
  eng: 'Ingles', en: 'Ingles',
  fra: 'Frances', fre: 'Frances', fr: 'Frances',
  deu: 'Aleman', ger: 'Aleman', de: 'Aleman',
  ita: 'Italiano', it: 'Italiano',
  por: 'Portugues', pt: 'Portugues',
  jpn: 'Japones', ja: 'Japones',
  kor: 'Coreano', ko: 'Coreano',
  zho: 'Chino', chi: 'Chino', zh: 'Chino',
  rus: 'Ruso', ru: 'Ruso',
  cat: 'Catalan', ca: 'Catalan',
  glg: 'Gallego', eus: 'Euskera',
  und: null, mul: 'Varios idiomas',
};

export function crearPistasAudio(player, opciones = {}) {
  const video = player.video;
  const lista = video.audioTracks ?? null;
  let idiomaPreferido = (opciones.ajustes?.audioLanguage ?? '').toLowerCase();
  let yaElegidaPara = null;
  const alCambiar = new Set();

  function pistas() {
    if (!lista) return [];
    const salida = [];
    for (let i = 0; i < lista.length; i++) {
      const pista = lista[i];
      salida.push({
        id: pista.id || String(i),
        indice: i,
        etiqueta: etiquetaDe(pista, i),
        idioma: pista.language || null,
        activa: !!pista.enabled,
      });
    }
    return salida;
  }

  function elegir(indice) {
    if (!lista || indice < 0 || indice >= lista.length) return false;
    // Exactamente una encendida. Chromium deja encender varias a la vez y lo
    // que sale entonces es la mezcla de las dos sonando encima, que se oye
    // como un error del archivo.
    for (let i = 0; i < lista.length; i++) lista[i].enabled = i === indice;
    avisar();
    return true;
  }

  function activa() {
    if (!lista) return -1;
    for (let i = 0; i < lista.length; i++) {
      if (lista[i].enabled) return i;
    }
    return -1;
  }

  function estado() {
    const todas = pistas();
    return {
      disponible: !!lista,
      // Con una sola pista no hay nada que elegir: el boton sobra en la barra.
      hay: todas.length > 1,
      pistas: todas,
      activa: activa(),
    };
  }

  function avisar() {
    for (const fn of alCambiar) fn(estado());
  }

  /**
   * Enciende la del idioma preferido, una sola vez por video.
   *
   * Se marca con `yaElegidaPara` porque las pistas no aparecen todas de
   * golpe: el contenedor las va publicando y cada una dispara 'addtrack'.
   * Sin la marca, la eleccion automatica se repetiria en cada aviso y
   * pisaria la que el usuario acabase de elegir a mano.
   */
  function aplicarPreferencia() {
    if (!lista || !idiomaPreferido) return;
    const track = player.track;
    if (!track || yaElegidaPara === track.id) return;
    if (lista.length < 2) return;

    for (let i = 0; i < lista.length; i++) {
      const idioma = (lista[i].language || '').toLowerCase();
      if (idioma && idioma.startsWith(idiomaPreferido)) {
        yaElegidaPara = track.id;
        elegir(i);
        return;
      }
    }
    yaElegidaPara = track.id;
  }

  if (lista) {
    lista.addEventListener('addtrack', () => {
      aplicarPreferencia();
      avisar();
    });
    lista.addEventListener('removetrack', avisar);
    lista.addEventListener('change', avisar);
  }

  player.on('trackchange', () => {
    yaElegidaPara = null;
    avisar();
  });

  player.on('metadatos', () => {
    aplicarPreferencia();
    avisar();
  });

  window.reele.settings.onChange((patch) => {
    if (patch.audioLanguage !== undefined) {
      idiomaPreferido = String(patch.audioLanguage).toLowerCase();
    }
  });

  return {
    estado,
    elegir,
    onCambio(fn) {
      alCambiar.add(fn);
      return () => alCambiar.delete(fn);
    },
  };
}

/**
 * Como se llama una pista en el menu.
 *
 * Manda el titulo que puso quien creo el archivo, porque suele ser lo mas
 * descriptivo ("Castellano", "Comentario del director"). Si no hay, se usa
 * el idioma; y si tampoco, el numero, que al menos permite ir probando.
 */
function etiquetaDe(pista, indice) {
  const titulo = (pista.label || '').trim();
  const idioma = (pista.language || '').toLowerCase();
  const nombreIdioma = IDIOMAS[idioma] ?? (idioma ? idioma.toUpperCase() : null);

  if (titulo && nombreIdioma && !titulo.toLowerCase().includes(nombreIdioma.toLowerCase())) {
    return `${titulo} · ${nombreIdioma}`;
  }
  return titulo || nombreIdioma || `Pista ${indice + 1}`;
}
