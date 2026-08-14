'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { protocol, app } = require('electron');

/**
 * Tres esquemas propios:
 *
 *   reele://app/...         la propia UI. Hace falta un esquema estandar
 *                           porque sobre file:// Chromium bloquea los
 *                           modulos ES por CORS y la CSP con 'self' no casa.
 *   reele-file://local/...  video del disco, con soporte de rangos para que
 *                           la barra de progreso pueda saltar.
 *   reele-thumb://cache/... fotogramas ya extraidos a la cache.
 */

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');

/** Raices autorizadas. Sin esto, cualquier ruta del disco seria servible. */
const allowedRoots = new Set();
/** Archivos sueltos autorizados (los que llegan por "Abrir con..."). */
const allowedFiles = new Set();

let thumbDir = null;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.ogv': 'video/ogg',
  '.vtt': 'text/vtt; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8',
};

function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

/** Se llama ANTES de app.ready o Chromium ignora los privilegios. */
function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'reele',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
    {
      scheme: 'reele-file',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
    {
      scheme: 'reele-thumb',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
}

/** Se llama despues de app.ready. */
function registerHandlers() {
  thumbDir = path.join(app.getPath('userData'), 'thumbcache');
  fs.mkdirSync(thumbDir, { recursive: true });

  protocol.handle('reele', async (request) => {
    const url = new URL(request.url);
    // Cualquier ruta desconocida cae en index.html para que la navegacion
    // interna no rompa si algun dia se usa history.pushState.
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const target = path.join(RENDERER_DIR, rel);
    if (!isInside(RENDERER_DIR, target)) return notFound();
    return serveFile(target, request);
  });

  protocol.handle('reele-file', async (request) => {
    const target = decodeKey(new URL(request.url).pathname);
    if (!target) return badRequest();
    if (!isAuthorized(target)) return forbidden();
    return serveFile(target, request);
  });

  protocol.handle('reele-thumb', async (request) => {
    const name = path.basename(decodeURIComponent(new URL(request.url).pathname));
    const target = path.join(thumbDir, name);
    if (!isInside(thumbDir, target)) return notFound();
    return serveFile(target, request);
  });
}

/**
 * Cabeceras CORS.
 *
 * La pagina vive en `reele://app` y el video en `reele-file://local`: son
 * origenes distintos. Un <video> normal se reproduciria igual, pero en cuanto
 * hay que leer sus pixeles con drawImage para sacar la miniatura, Chromium
 * considera el lienzo contaminado y toDataURL lanza una excepcion de
 * seguridad. Con `crossOrigin` en el elemento y este permiso en la respuesta,
 * la fuente es limpia y el fotograma se puede extraer.
 *
 * Abrir a `*` no afila nada: quien decide que se puede leer es isAuthorized,
 * y ningun origen externo puede alcanzar estos esquemas.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
};

/**
 * Sirve un archivo con soporte de rangos.
 *
 * Los rangos no son opcionales aqui, son la funcion principal: sin
 * `206 Partial Content` el elemento <video> descarga el archivo entero antes
 * de poder saltar, y en una pelicula de 4 GB arrastrar la barra de progreso
 * deja la aplicacion colgada varios minutos.
 */
async function serveFile(target, request) {
  let stat;
  try {
    stat = await fsp.stat(target);
    if (!stat.isFile()) return notFound();
  } catch {
    return notFound();
  }

  const type = mimeFor(target);
  const range = request.headers.get('Range');
  const parsed = range ? parseRange(range, stat.size) : null;

  if (range && !parsed) {
    return new Response(null, {
      status: 416,
      headers: { ...CORS, 'Content-Range': `bytes */${stat.size}` },
    });
  }

  const start = parsed ? parsed.start : 0;
  const end = parsed ? parsed.end : stat.size - 1;
  const stream = fs.createReadStream(target, { start, end });

  return new Response(Readable.toWeb(stream), {
    status: parsed ? 206 : 200,
    headers: {
      ...CORS,
      'Content-Type': type,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
      ...(parsed ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}),
      'Cache-Control': 'no-cache',
    },
  });
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  let start;
  let end;
  if (rawStart === '') {
    // Sufijo: los ultimos N bytes. Es lo primero que pide Chromium en un mp4
    // cuyo indice esta al final del archivo.
    const n = Number(rawEnd);
    if (!Number.isFinite(n) || n <= 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start < 0 || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

// --- Autorizacion ---------------------------------------------------------

function allowRoot(dir) {
  if (dir) allowedRoots.add(path.resolve(dir).toLowerCase());
}

function allowFile(file) {
  if (file) allowedFiles.add(path.resolve(file).toLowerCase());
}

function clearRoots() {
  allowedRoots.clear();
}

function isAuthorized(target) {
  const resolved = path.resolve(target).toLowerCase();
  if (allowedFiles.has(resolved)) return true;
  for (const root of allowedRoots) {
    if (isInside(root, resolved)) return true;
  }
  return false;
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// --- Claves de ruta -------------------------------------------------------

/**
 * Las rutas de Windows no caben limpias en una URL: llevan `C:`, barras
 * invertidas y `#`. Van en base64url, que no necesita escapado.
 */
function encodePath(absPath) {
  return `reele-file://local/${Buffer.from(absPath, 'utf8').toString('base64url')}`;
}

function decodeKey(pathname) {
  const key = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (!key) return null;
  try {
    const decoded = Buffer.from(key, 'base64url').toString('utf8');
    return decoded.includes('\0') ? null : decoded;
  } catch {
    return null;
  }
}

function thumbUrl(fileName) {
  return `reele-thumb://cache/${encodeURIComponent(fileName)}`;
}

function getThumbDir() {
  return thumbDir;
}

// --- Respuestas cortas ----------------------------------------------------

const notFound = () => new Response('no encontrado', { status: 404 });
const forbidden = () => new Response('no autorizado', { status: 403 });
const badRequest = () => new Response('peticion invalida', { status: 400 });

module.exports = {
  registerSchemes,
  registerHandlers,
  allowRoot,
  allowFile,
  clearRoots,
  isAuthorized,
  encodePath,
  thumbUrl,
  getThumbDir,
  mimeFor,
};
