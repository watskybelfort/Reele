'use strict';

/**
 * De un nombre de archivo a algo que se pueda leer.
 *
 * Un reproductor de musica saca el titulo de las etiquetas del archivo. Un
 * video no tiene equivalente: el 99% de lo que hay en un disco viene sin
 * metadatos y con el nombre que le puso quien lo empaqueto, que es de la
 * forma
 *
 *     Nombre.De.La.Pelicula.2019.1080p.BluRay.x265-GRUPO.mkv
 *     Serie Buena S02E07 [WEB-DL 1080p AAC] -EQUIPO.mkv
 *
 * Ensenar eso tal cual en la lista convierte la biblioteca en un muro de
 * ruido tecnico donde no se distingue una cosa de otra. Aqui se separa lo
 * que interesa (titulo, ano, temporada y episodio) de lo que no, y lo que no
 * NO se tira: se guarda aparte para poder ensenarlo en la ficha del video,
 * porque saber si algo es 1080p o 4K si importa cuando lo que quieres es
 * decidir cual de las dos copias abrir.
 *
 * Es heuristica, no un estandar, asi que se equivoca a veces. Por eso el
 * nombre original del archivo se conserva siempre y la ficha lo ensena: si
 * el titulo limpio sale raro, el usuario ve por que.
 */

/**
 * Palabras de "release" que no forman parte de ningun titulo.
 *
 * Van sueltas, comparadas token a token: buscarlas como subcadena convertiria
 * "Dune" en "D" por culpa de "une", y "Cars" perderia la mitad por "ars".
 */
const RUIDO = new Set([
  '2160p', '1440p', '1080p', '1080i', '720p', '576p', '480p', '4k', '8k', 'uhd', 'fhd', 'hd', 'sd',
  'hdr', 'hdr10', 'hdr10plus', 'dv', 'dolbyvision', 'sdr', '10bit', '8bit', '10bits',
  'x264', 'x265', 'h264', 'h265', 'hevc', 'avc', 'av1', 'vp9', 'xvid', 'divx', 'mpeg2',
  'aac', 'aac2', 'ac3', 'eac3', 'ddp', 'ddp5', 'dd5', 'dd', 'dts', 'dtshd', 'truehd', 'atmos',
  'flac', 'mp3', 'opus', '2ch', '6ch', '8ch', '5', '7',
  'bluray', 'blu-ray', 'brrip', 'bdrip', 'bdremux', 'remux', 'webrip', 'web', 'webdl', 'web-dl',
  'hdtv', 'pdtv', 'dvdrip', 'dvdscr', 'hdrip', 'camrip', 'cam', 'ts', 'tc',
  'repack', 'proper', 'internal', 'limited', 'complete', 'readnfo',
  'extended', 'uncut', 'unrated', 'remastered', 'theatrical', 'directors',
  'multi', 'dual', 'dualaudio', 'latino', 'castellano', 'spanish', 'english', 'ingles',
  'sub', 'subs', 'subtitulado', 'vose', 'vos', 'vo', 'vs',
  'esp', 'spa', 'eng', 'ita', 'fre', 'ger', 'jpn', 'lat',
  'amzn', 'nf', 'netflix', 'dsnp', 'hmax', 'atvp', 'hulu', 'pcok', 'stan',
  'yify', 'yts', 'rarbg', 'evo', 'sparks', 'ntb', 'ion10',
]);

/** SxxEyy, 1x02, temporada 2 capitulo 7. */
const SERIE = [
  /\bs(\d{1,2})[\s._-]*e(\d{1,3})\b/i,
  /\b(\d{1,2})x(\d{1,3})\b/i,
  /\btemporada[\s._-]*(\d{1,2})[\s._-]*(?:cap(?:itulo)?|ep(?:isodio)?)[\s._-]*(\d{1,3})\b/i,
];

/** Un ano suelto, no un numero cualquiera de cuatro cifras. */
const ANIO = /\b(19\d{2}|20\d{2})\b/;

/**
 * Analiza el nombre (sin extension) y devuelve lo que se pueda deducir.
 * Nunca lanza y nunca devuelve el titulo vacio.
 */
function analizar(base) {
  const original = String(base ?? '').trim();
  if (!original) return vacio(original);

  // Los corchetes y las llaves envuelven casi siempre el bloque tecnico
  // entero. Se quitan de una pieza antes de mirar nada mas, que ahorra media
  // docena de tokens de ruido.
  let texto = original.replace(/[[{(][^\])}]*(?:web|blu|hdtv|dvd|x26|h26|hevc|aac|ac3|dts|1080|720|2160|4k)[^\])}]*[\]})]/gi, ' ');

  // Los puntos se cambian por espacios SOLO si son el separador del nombre.
  // Con esta comprobacion, "Dr. Strange in the Multiverse" conserva su punto
  // y "Rick.and.Morty.S07E01" se abre en palabras. Y se hace antes de tocar
  // nada mas: haciendolo despues de quitar el episodio, el nombre ya tendria
  // un espacio y esta condicion daria falso.
  const separadoPorPuntos = !texto.includes(' ') && (texto.match(/\./g) ?? []).length >= 2;
  if (separadoPorPuntos) texto = texto.replace(/\./g, ' ');
  texto = texto.replace(/_/g, ' ');

  /*
   * El grupo va al final, detras de un guion PEGADO a lo que sigue:
   * "x265-GRUPO", "-EQUIPO". El guion pegado es la parte que distingue un
   * grupo de un subtitulo de verdad: en "Temporada 1 Capitulo 03 - Piloto"
   * hay un espacio despues del guion, y sin exigirlo el filtro se llevaba
   * por delante el nombre del episodio y dejaba la entrada sin titulo.
   *
   * Y tiene que llevar alguna letra: un sufijo de puras cifras es una fecha
   * o un ano ("concierto-2023"), nunca el nombre de un grupo.
   */
  texto = texto.replace(/-(?=[A-Za-z0-9._]*[A-Za-z])[A-Za-z0-9][A-Za-z0-9._]{1,}\s*$/, ' ');

  const anioEncontrado = ANIO.exec(texto);
  const anio = anioEncontrado ? Number(anioEncontrado[1]) : null;

  /*
   * El marcador de episodio parte el nombre en dos.
   *
   * Delante va el titulo de la serie y detras el del capitulo, si lo trae.
   * Se prefiere lo de delante porque es lo que agrupa: en la lista sirve mas
   * "Rick and Morty" repetido que veinte nombres de capitulo sueltos. Solo
   * cuando delante no queda nada — "Temporada 1 Capitulo 03 - Piloto" — se
   * usa lo de detras, que ahi es lo unico que hay.
   */
  const serie = detectarSerie(texto);
  const [antes, despues] = serie
    ? partir(texto, serie.crudo)
    : [texto, ''];

  const cabeza = tokenizar(antes, anio);
  const cola = tokenizar(despues, anio);
  const limpio = cabeza.titulo || cola.titulo;

  return {
    // Si el filtro se paso de listo y no dejo nada, manda el nombre original:
    // una fila en blanco es peor que una fila fea.
    title: limpio || pulir(original) || original,
    year: anio,
    season: serie?.temporada ?? null,
    episode: serie?.episodio ?? null,
    // Solo las que aportan algo al elegir entre dos copias del mismo video.
    etiquetas: [...new Set([...cabeza.etiquetas, ...cola.etiquetas].map((e) => e.toUpperCase()))].slice(0, 6),
  };
}

function partir(texto, crudo) {
  const i = texto.indexOf(crudo);
  if (i < 0) return [texto, ''];
  return [texto.slice(0, i), texto.slice(i + crudo.length)];
}

/**
 * Separa el titulo del ruido tecnico.
 *
 * Todo lo que viene DESPUES del ano o del primer token de ruido deja de ser
 * titulo: nadie llama a una pelicula "Origen 2010 BluRay". Lo que se descarta
 * no se tira, se devuelve como etiqueta.
 */
function tokenizar(texto, anio) {
  const titulo = [];
  const etiquetas = [];
  let enElTitulo = true;

  for (const bruto of String(texto).split(/\s+/)) {
    const token = bruto.replace(/^[([{]+|[)\]}]+$/g, '');
    if (!token) continue;
    const llano = token.toLowerCase().replace(/[^a-z0-9-]/g, '');

    if (anio && token === String(anio)) {
      enElTitulo = false;
      continue;
    }
    if (RUIDO.has(llano)) {
      enElTitulo = false;
      etiquetas.push(token);
      continue;
    }
    if (enElTitulo) titulo.push(token);
    else etiquetas.push(token);
  }

  return { titulo: pulir(titulo.join(' ')), etiquetas };
}

function detectarSerie(texto) {
  for (const patron of SERIE) {
    const m = patron.exec(texto);
    if (m) {
      return { crudo: m[0], temporada: Number(m[1]), episodio: Number(m[2]) };
    }
  }
  return null;
}

/** Espacios de sobra, guiones sueltos y separadores en los extremos. */
function pulir(s) {
  return String(s)
    .replace(/\s+/g, ' ')
    .replace(/\s*[-–—]\s*$/, '')
    .replace(/^\s*[-–—]\s*/, '')
    .trim();
}

function vacio(original) {
  return { title: original || 'Sin nombre', year: null, season: null, episode: null, etiquetas: [] };
}

/** 'S02E07' para ensenar junto al titulo. Null si no es un episodio. */
function etiquetaEpisodio({ season, episode }) {
  if (!season && !episode) return null;
  const s = String(season ?? 1).padStart(2, '0');
  const e = String(episode ?? 1).padStart(2, '0');
  return `S${s}E${e}`;
}

module.exports = { analizar, etiquetaEpisodio };
