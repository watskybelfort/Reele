'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const { SUBTITLE_EXTENSIONS } = require('./defaults');

/**
 * Subtitulos que viven junto al video.
 *
 * Solo externos, y conviene decirlo claro porque es la limitacion que mas se
 * nota: Chromium NO expone las pistas de subtitulos incrustadas en un MKV.
 * Las decodifica para reproducirlas, pero no las publica en `textTracks`, y
 * no hay forma desde la pagina de enumerarlas ni de encenderlas. Sacarlas
 * significaria demultiplexar el contenedor a mano, que es exactamente lo que
 * esta aplicacion evita.
 *
 * Lo que si se puede hacer —y es lo que cubre el caso real, porque casi todo
 * lo que se descarga trae su .srt al lado— es encontrar los archivos sueltos,
 * entenderlos y pintarlos.
 */

const EXTS = new Set(SUBTITLE_EXTENSIONS);

/** Carpetas donde la gente guarda los subtitulos de una carpeta entera. */
const SUBCARPETAS = ['subs', 'subtitles', 'subtitulos', 'subtítulos'];

/**
 * Sufijos de idioma que se ven en los nombres.
 *
 * La clave es lo que aparece en el archivo; el valor, como se ensena en el
 * menu. No pretende ser una tabla ISO completa: es la lista de lo que uno se
 * encuentra de verdad al lado de un video.
 */
const IDIOMAS = {
  es: 'Espanol', spa: 'Espanol', esp: 'Espanol', spanish: 'Espanol',
  'es-es': 'Espanol', 'es-la': 'Espanol (latino)', lat: 'Espanol (latino)', latino: 'Espanol (latino)',
  en: 'Ingles', eng: 'Ingles', english: 'Ingles', 'en-us': 'Ingles',
  fr: 'Frances', fre: 'Frances', fra: 'Frances', french: 'Frances',
  de: 'Aleman', ger: 'Aleman', deu: 'Aleman', german: 'Aleman',
  it: 'Italiano', ita: 'Italiano', italian: 'Italiano',
  pt: 'Portugues', por: 'Portugues', 'pt-br': 'Portugues (Brasil)',
  ja: 'Japones', jpn: 'Japones', japanese: 'Japones',
  ko: 'Coreano', kor: 'Coreano',
  zh: 'Chino', chi: 'Chino', zho: 'Chino',
  ru: 'Ruso', rus: 'Ruso',
  ca: 'Catalan', cat: 'Catalan',
  gl: 'Gallego', eu: 'Euskera',
};

/** Marcas que no son idioma pero si dicen algo de la pista. */
const MATICES = {
  forced: 'forzados', forzados: 'forzados',
  sdh: 'SDH', cc: 'CC', hi: 'SDH',
};

/**
 * Todos los subtitulos que acompanan a un video.
 *
 * Devuelve descripciones, no contenido: una serie entera puede tener
 * doscientos .srt al lado y leerlos todos para pintar un menu de tres
 * entradas seria absurdo. El contenido se pide con `leer` al elegir uno.
 */
async function buscar(rutaVideo) {
  const dir = path.dirname(rutaVideo);
  const base = path.basename(rutaVideo, path.extname(rutaVideo));
  const baseBaja = base.toLowerCase();
  const encontrados = [];

  const mirar = async (carpeta, exigirPrefijo) => {
    let entradas;
    try {
      entradas = await fsp.readdir(carpeta, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entrada of entradas) {
      if (!entrada.isFile()) continue;
      const ext = path.extname(entrada.name).toLowerCase();
      if (!EXTS.has(ext)) continue;
      const nombreBase = path.basename(entrada.name, ext);
      if (exigirPrefijo && !nombreBase.toLowerCase().startsWith(baseBaja)) continue;
      encontrados.push(path.join(carpeta, entrada.name));
    }
  };

  await mirar(dir, true);

  for (const sub of SUBCARPETAS) {
    // En las subcarpetas comunes no se exige el prefijo solo si la carpeta
    // es del propio video ("Pelicula/Subs"); si es la de toda una temporada,
    // sin prefijo saldrian los subtitulos de los trece capitulos en el menu
    // de uno solo.
    await mirar(path.join(dir, sub), true);
  }
  // Una carpeta con el nombre exacto del video es suya entera.
  await mirar(path.join(dir, base), false);

  return encontrados.map((ruta) => describir(ruta, base));
}

function describir(ruta, base) {
  const ext = path.extname(ruta).toLowerCase();
  const nombre = path.basename(ruta, ext);
  // Lo que sobra del nombre despues de quitar el del video son los sufijos:
  // "Pelicula.es.forced" -> ["es", "forced"].
  const cola = nombre.toLowerCase().startsWith(base.toLowerCase())
    ? nombre.slice(base.length)
    : nombre;
  const trozos = cola.split(/[.\-_\s]+/).filter(Boolean);

  let idioma = null;
  const matices = [];
  for (const trozo of trozos) {
    const llano = trozo.toLowerCase();
    if (!idioma && IDIOMAS[llano]) idioma = IDIOMAS[llano];
    else if (MATICES[llano]) matices.push(MATICES[llano]);
  }

  const etiqueta = [idioma ?? (trozos.length ? trozos.join(' ') : 'Subtitulos'), ...matices]
    .filter(Boolean)
    .join(' · ');

  return {
    // Id estable por ruta: sobrevive a cerrar y volver a abrir el video, que
    // es lo que hace falta para poder recordar cual estaba elegido.
    id: crypto.createHash('sha1').update(ruta.toLowerCase()).digest('hex').slice(0, 12),
    ruta,
    nombre: path.basename(ruta),
    etiqueta,
    idioma,
    formato: ext.slice(1),
  };
}

/**
 * Lee un archivo y devuelve sus lineas con tiempos.
 *
 * Los tres formatos acaban en la misma forma —inicio, fin y texto— porque
 * quien los pinta es la propia aplicacion. Se pinta a mano y no con el
 * <track> nativo porque asi el retardo, el tamano y la posicion se pueden
 * cambiar sobre la marcha; con el renderizado del navegador, ajustar el
 * retardo obliga a reconstruir la pista entera en cada pulsacion.
 */
async function leer(ruta) {
  let crudo;
  try {
    crudo = await fsp.readFile(ruta);
  } catch (err) {
    return { ok: false, error: err.message, cues: [] };
  }

  const texto = decodificar(crudo);
  const ext = path.extname(ruta).toLowerCase();
  const cues = ext === '.ass' || ext === '.ssa'
    ? deAss(texto)
    : deSrtOVtt(texto);

  cues.sort((a, b) => a.start - b.start);
  return { ok: true, cues, total: cues.length };
}

/**
 * Los .srt del mundo real no siempre son UTF-8.
 *
 * Media Europa los tiene en Windows-1252 o en Latin-1, y leerlos como UTF-8
 * llena la pantalla de rombos negros justo en las palabras con acento, que
 * en castellano son casi todas. Se prueba UTF-8 y, si el resultado trae el
 * caracter de reemplazo, se vuelve a decodificar como Windows-1252.
 */
function decodificar(buffer) {
  const sinBom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
    ? buffer.subarray(3)
    : buffer;

  const utf8 = sinBom.toString('utf8');
  if (!utf8.includes('�')) return utf8;

  try {
    return new TextDecoder('windows-1252').decode(sinBom);
  } catch {
    return utf8;
  }
}

/**
 * SRT y VTT comparten estructura: bloques separados por una linea en blanco,
 * con una linea de tiempos y el texto debajo. La unica diferencia real es el
 * separador de los milisegundos, coma en SRT y punto en VTT, y se aceptan
 * los dos sin preguntar de que archivo venimos.
 */
const TIEMPOS = /(\d{1,3}:)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})\s*-->\s*(\d{1,3}:)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/;

function deSrtOVtt(texto) {
  const cues = [];
  const bloques = texto.replace(/\r\n?/g, '\n').split(/\n{2,}/);

  for (const bloque of bloques) {
    const lineas = bloque.split('\n').filter((l) => l.trim() !== '');
    if (!lineas.length) continue;

    const i = lineas.findIndex((l) => TIEMPOS.test(l));
    if (i < 0) continue; // cabecera WEBVTT, NOTE, o el numero suelto

    const m = TIEMPOS.exec(lineas[i]);
    const start = segundos(m[1], m[2], m[3], m[4]);
    const end = segundos(m[5], m[6], m[7], m[8]);
    const texto2 = limpiar(lineas.slice(i + 1).join('\n'));
    if (!texto2 || end <= start) continue;

    cues.push({ start, end, text: texto2 });
  }
  return cues;
}

/**
 * ASS/SSA.
 *
 * Se toman los tiempos y el texto, y se deja fuera el estilo: tipografia,
 * colores, posiciones y karaoke son un motor de renderizado entero. Es una
 * perdida real y la UI lo dice, pero un subtitulo sin su fuente original se
 * lee perfectamente, y no tenerlo significa no tener subtitulos.
 */
function deAss(texto) {
  const cues = [];
  const lineas = texto.replace(/\r\n?/g, '\n').split('\n');
  // El orden de los campos lo declara la propia cabecera del bloque: no
  // siempre es el mismo, y dar por hecho el habitual saca los tiempos
  // cambiados en los archivos que traen otro.
  let campos = ['Layer', 'Start', 'End', 'Style', 'Name', 'MarginL', 'MarginR', 'MarginV', 'Effect', 'Text'];

  for (const linea of lineas) {
    if (linea.startsWith('Format:') && cues.length === 0) {
      const declarados = linea.slice(7).split(',').map((s) => s.trim());
      if (declarados.includes('Start') && declarados.includes('Text')) campos = declarados;
      continue;
    }
    if (!linea.startsWith('Dialogue:')) continue;

    // El texto puede llevar comas dentro, asi que solo se parte tantas veces
    // como campos haya antes de el.
    const partes = linea.slice(9).split(',');
    const iTexto = campos.indexOf('Text');
    if (iTexto < 0 || partes.length <= iTexto) continue;

    const valor = (nombre) => partes[campos.indexOf(nombre)]?.trim() ?? '';
    const start = deTiempoAss(valor('Start'));
    const end = deTiempoAss(valor('End'));
    const text = limpiar(partes.slice(iTexto).join(',').replace(/\\N/gi, '\n'));
    if (!text || !(end > start)) continue;

    cues.push({ start, end, text });
  }
  return cues;
}

function deTiempoAss(v) {
  const m = /^(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/.exec(v.trim());
  if (!m) return NaN;
  return segundos(`${m[1]}:`, m[2], m[3], m[4]);
}

function segundos(horas, minutos, segs, milis) {
  const h = horas ? Number.parseInt(horas, 10) : 0;
  // Los milisegundos pueden venir con dos cifras (centesimas, en ASS) o con
  // tres. Se normaliza a tres antes de dividir, o un ".50" valdria 0,05 s.
  const ms = Number(String(milis).padEnd(3, '0'));
  return h * 3600 + Number(minutos) * 60 + Number(segs) + ms / 1000;
}

/** Etiquetas de estilo y anotaciones que no se pintan. */
function limpiar(s) {
  return String(s)
    .replace(/\{[^}]*\}/g, '')      // llaves de ASS y de algunos SRT
    .replace(/<[^>]+>/g, '')        // <i>, <b>, <font ...>
    .replace(/\\[Nnh]/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

module.exports = { buscar, leer };
