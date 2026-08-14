/**
 * Paleta adaptativa: el color del vidrio sale del fotograma del video.
 *
 * Se extrae el color dominante de la portada que saco el sondeo, se convierte
 * en dos cosas distintas y se deriva de una a otra con una transicion larga:
 *
 *   --acento  vivo y legible, para barras, focos y estados activos.
 *   --tinte   el mismo tono pero oscuro y desaturado, la veladura del vidrio.
 *
 * El acento NO es el color tal cual sale del fotograma. Una escena nocturna
 * daria un acento invisible sobre el vidrio y un plano de cesped fluorescente
 * quemaria los ojos: se conserva el tono, que es lo que identifica a la
 * pelicula, y se meten saturacion y luminosidad en un rango que siempre se
 * lee.
 *
 * La transicion va en HSL por el camino corto del tono, no en RGB. De azul a
 * naranja, interpolando canal a canal, se pasa por un gris sucio en mitad; en
 * HSL el color gira por el circulo y siempre parece color.
 *
 * Se mira el fotograma guardado y no la imagen en marcha. Muestrear el video
 * fotograma a fotograma daria un tinte que cambia con cada plano, y una
 * interfaz que parpadea de color durante una pelicula entera es insoportable
 * — ademas de un drawImage de 4K por fotograma para adornar un borde.
 */

import { clamp } from './dom.js';

/** El fotograma se mira reducido; con 16:9 no hace falta cuadrarlo. */
const ANCHO = 64;
const ALTO = 36;

const ACENTO_POR_DEFECTO = { h: 258, s: 0.9, l: 0.76 }; // #A78BFA

export function crearPaleta({ ajustes = {} } = {}) {
  const raiz = document.documentElement;
  const cache = new Map();
  let lienzo = null;
  let ctx = null;

  let adaptativo = ajustes.adaptiveColor !== false;
  let reserva = ajustes.accentFallback ? hexAHsl(ajustes.accentFallback) : { ...ACENTO_POR_DEFECTO };
  let actual = { ...reserva };
  let animacion = 0;
  let ultimo = null;

  escribir(actual);

  /**
   * La duracion vive en --dur-paleta, en el CSS, para que sea el mismo numero
   * que documenta el tema y para que el ajuste de movimiento reducido, que la
   * pone a cero, se respete sin preguntarlo aparte.
   */
  function duracion() {
    const bruto = getComputedStyle(raiz).getPropertyValue('--dur-paleta');
    const ms = Number.parseFloat(bruto);
    return Number.isFinite(ms) ? ms : 900;
  }

  function escribir({ h, s, l }) {
    const acento = hslARgb(h, s, l);
    // El tinte comparte tono pero apenas saturacion: una veladura saturada
    // tine toda la interfaz y deja de parecer vidrio para parecer plastico.
    const tinte = hslARgb(h, Math.min(s, 0.3), 0.065);
    raiz.style.setProperty('--acento', `${acento.r} ${acento.g} ${acento.b}`);
    raiz.style.setProperty('--tinte', `${tinte.r} ${tinte.g} ${tinte.b}`);
  }

  function animarA(destino) {
    cancelAnimationFrame(animacion);
    const desde = { ...actual };
    // Camino corto del circulo: de 350 a 10 grados son 20, no 340.
    let delta = destino.h - desde.h;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;

    const ms = duracion();
    if (ms <= 0) {
      actual = { ...destino };
      escribir(actual);
      return;
    }

    const t0 = performance.now();
    const paso = (ahora) => {
      const t = clamp((ahora - t0) / ms, 0, 1);
      const k = t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
      actual = {
        h: (desde.h + delta * k + 360) % 360,
        s: desde.s + (destino.s - desde.s) * k,
        l: desde.l + (destino.l - desde.l) * k,
      };
      escribir(actual);
      if (t < 1) animacion = requestAnimationFrame(paso);
    };
    animacion = requestAnimationFrame(paso);
  }

  async function aplicar(track) {
    ultimo = track ?? null;
    if (!adaptativo) return;

    const url = track?.thumbUrl;
    if (!url) {
      animarA({ ...reserva });
      return;
    }

    if (cache.has(url)) {
      animarA(cache.get(url));
      return;
    }

    try {
      const color = await extraer(url);
      cache.set(url, color);
      // Puede haber cambiado de video mientras se decodificaba la imagen.
      if (adaptativo && ultimo?.thumbUrl === url) animarA(color);
    } catch (err) {
      console.warn('[paleta] no pude leer el fotograma:', err.message);
    }
  }

  async function extraer(url) {
    const imagen = new Image();
    // Sin CORS, leer los pixeles mancha el lienzo y getImageData lanza.
    imagen.crossOrigin = 'anonymous';
    imagen.src = url;
    await imagen.decode();

    if (!lienzo) {
      lienzo = document.createElement('canvas');
      lienzo.width = ANCHO;
      lienzo.height = ALTO;
      ctx = lienzo.getContext('2d', { willReadFrequently: true });
    }

    ctx.clearRect(0, 0, ANCHO, ALTO);
    ctx.drawImage(imagen, 0, 0, ANCHO, ALTO);
    return dominante(ctx.getImageData(0, 0, ANCHO, ALTO).data);
  }

  window.reele.settings.onChange((patch) => {
    if (patch.accentFallback !== undefined) reserva = hexAHsl(patch.accentFallback);
    if (patch.adaptiveColor === undefined) return;
    adaptativo = patch.adaptiveColor !== false;
    // Apagarlo devuelve el color de reserva; encenderlo vuelve a mirar lo que
    // haya en pantalla. Sin esto el ajuste no hace nada hasta el video
    // siguiente, y parece que no funciona.
    if (adaptativo) aplicar(ultimo);
    else animarA({ ...reserva });
  });

  return {
    aplicar,
    get adaptativo() { return adaptativo; },
    get hexActual() {
      const { r, g, b } = hslARgb(actual.h, actual.s, actual.l);
      return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    },
  };
}

/**
 * Color dominante por histograma.
 *
 * No vale con promediar la imagen entera: la media de un fotograma con mitad
 * cielo azul y mitad campo verde es un gris que no aparece en ningun pixel.
 * Se agrupan los pixeles en cubos gruesos de color, gana el cubo con mas peso
 * y se promedian solo los suyos, que si son parecidos entre si.
 */
function dominante(data) {
  const cubos = new Map();
  let mejorClave = null;
  let mejorPeso = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const [, s, l] = rgbAHsl(r, g, b);

    // Las bandas negras del encuadre y los blancos quemados no dicen nada de
    // la pelicula y ademas darian un acento ilegible.
    if (l < 0.12 || l > 0.93) continue;

    // Pesa mas lo colorido y lo de luminosidad media, que es lo que el ojo
    // reconoce como "el color" de una escena.
    const peso = 1 + s * 4 + (1 - Math.abs(l - 0.5) * 2) * 1.5;
    const clave = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);

    let cubo = cubos.get(clave);
    if (!cubo) {
      cubo = { r: 0, g: 0, b: 0, peso: 0 };
      cubos.set(clave, cubo);
    }
    cubo.r += r * peso;
    cubo.g += g * peso;
    cubo.b += b * peso;
    cubo.peso += peso;

    if (cubo.peso > mejorPeso) {
      mejorPeso = cubo.peso;
      mejorClave = clave;
    }
  }

  if (mejorClave === null) return { ...ACENTO_POR_DEFECTO };

  const cubo = cubos.get(mejorClave);
  const [h, s, l] = rgbAHsl(cubo.r / cubo.peso, cubo.g / cubo.peso, cubo.b / cubo.peso);

  // Se conserva el tono, que es lo que identifica a la escena, y se corrigen
  // saturacion y luz para que el resultado se lea siempre sobre el vidrio.
  return { h, s: clamp(s, 0.45, 0.92), l: clamp(l, 0.56, 0.74) };
}

// --- Conversiones ---------------------------------------------------------

function rgbAHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslARgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (!s) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const canal = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return {
    r: Math.round(canal(h + 1 / 3) * 255),
    g: Math.round(canal(h) * 255),
    b: Math.round(canal(h - 1 / 3) * 255),
  };
}

function hexAHsl(hex) {
  const limpio = String(hex).replace('#', '').trim();
  if (limpio.length !== 6) return { ...ACENTO_POR_DEFECTO };
  const n = Number.parseInt(limpio, 16);
  const [h, s, l] = rgbAHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
  return { h, s, l };
}
