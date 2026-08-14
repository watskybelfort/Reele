/**
 * Ayudas de DOM y formato.
 *
 * Los glifos de Segoe Fluent Icons viven en el area privada de Unicode y se
 * escriben con su codigo, no con el caracter: pegado literal en un .js se
 * pierde al guardar y lo que aparece en pantalla son cuadraditos.
 */

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

export const ICONO = {
  reproducir: 0xe768,
  pausa: 0xe769,
  anterior: 0xe892,
  siguiente: 0xe893,
  aleatorio: 0xe8b1,
  repetirTodo: 0xe8ee,
  repetirUna: 0xe8ed,
  volumen0: 0xe992,
  volumen1: 0xe993,
  volumen2: 0xe994,
  volumen3: 0xe995,
  silencio: 0xe74f,
  video: 0xe714,
  carpeta: 0xe8b7,
  anadir: 0xe710,
  abrir: 0xe8e5,
  buscar: 0xe721,
  quitar: 0xe711,
  refrescar: 0xe72c,
  plegar: 0xe76b,
  desplegar: 0xe76c,
  flechaArriba: 0xe70e,
  flechaAbajo: 0xe70d,
  atras: 0xe72b,
  cola: 0xe8fd,
  corazon: 0xeb51,
  corazonLleno: 0xeb52,
  reciente: 0xe823,
  lista: 0xe90b,
  mas: 0xe712,
  renombrar: 0xe8ac,
  papelera: 0xe74d,
  asa: 0xe76f,
  ajustes: 0xe713,
  aPantalla: 0xe740,
  aVentana: 0xe73f,
  ojo: 0xe890,
};

export const glifo = (nombre) => String.fromCharCode(ICONO[nombre] ?? 0xe783);

export function pintarGlifo(el, nombre) {
  if (el) el.textContent = glifo(nombre);
}

/**
 * Iconos que no salen de la fuente.
 *
 * Los subtitulos, las pistas de audio y el mini reproductor no tienen glifo
 * garantizado en todas las versiones de Segoe: en un Windows sin la fuente
 * nueva saldria el cuadradito de "carácter desconocido" justo en tres botones
 * de los que mas se usan. Se dibujan a mano, que ademas los deja del mismo
 * grosor que el resto pase lo que pase.
 *
 * Se construyen con createElementNS y no con innerHTML: es la unica forma de
 * crear nodos SVG de verdad, y de paso no hay ni una cadena de marcado
 * suelta por el codigo.
 */
const SVG = 'http://www.w3.org/2000/svg';

const TRAZOS = {
  // Recuadro con dos lineas dentro: el simbolo universal de subtitulos.
  subtitulos: [
    ['rect', { x: 1.8, y: 3.4, width: 12.4, height: 9.2, rx: 2 }],
    ['path', { d: 'M4.4 7.6h3.2M9.6 7.6h2M4.4 10.1h2M8.4 10.1h3.2' }],
  ],
  // Dos capas: "hay mas de una pista y puedes elegir".
  pistas: [
    ['rect', { x: 2.2, y: 5.6, width: 9, height: 7.4, rx: 1.8 }],
    ['path', { d: 'M5.6 3.2h6.4a1.8 1.8 0 0 1 1.8 1.8v5.2' }],
  ],
  // Ventana grande con una pequena encajada abajo a la derecha.
  mini: [
    ['rect', { x: 1.6, y: 3, width: 12.8, height: 10, rx: 2 }],
    ['rect', { x: 7.8, y: 7.6, width: 5.2, height: 4, rx: 1, fill: 'currentColor' }],
  ],
};

export function iconoSvg(nombre) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'svg-icono');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, atributos] of TRAZOS[nombre] ?? []) {
    const forma = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(atributos)) forma.setAttribute(k, String(v));
    svg.append(forma);
  }
  return svg;
}

export function pintarSvg(el, nombre) {
  if (!el) return;
  el.replaceChildren(iconoSvg(nombre));
}

export function el(tag, props = {}, hijos = []) {
  const nodo = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') nodo.className = v;
    else if (k === 'dataset') Object.assign(nodo.dataset, v);
    else if (k === 'texto') nodo.textContent = v;
    else if (k.startsWith('on')) nodo.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) nodo.setAttribute(k, v === true ? '' : String(v));
  }
  for (const h of [hijos].flat()) {
    if (h) nodo.append(h);
  }
  return nodo;
}

/**
 * 214 -> '3:34'. Por encima de la hora anade el campo de horas.
 *
 * A diferencia de un reproductor de musica, aqui lo normal es pasar de la
 * hora: el formato largo no es un caso raro que se pueda descuidar.
 */
export function formatoTiempo(segundos) {
  if (!Number.isFinite(segundos) || segundos < 0) return '0:00';
  const total = Math.floor(segundos);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const dos = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${dos(m)}:${dos(s)}` : `${m}:${dos(s)}`;
}

/** '1 h 47 min' — para resumir sin dar la precision al segundo. */
export function formatoLargo(segundos) {
  const total = Math.max(0, Math.round(Number(segundos) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${Math.max(1, m)} min`;
}

/** '3 videos' / '1 video': el plural mal puesto canta mucho. */
export function plural(n, singular, plural_) {
  return `${n} ${n === 1 ? singular : plural_}`;
}

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}
