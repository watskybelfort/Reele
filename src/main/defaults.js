'use strict';

/**
 * Valores por defecto de todo lo persistente.
 *
 * OJO con la diferencia que confunde a todo el mundo:
 *   - `backdropAlpha` es la veladura que DWM pone DETRAS de la pagina,
 *     mezclada con el escritorio difuminado. Sube el numero y el escritorio
 *     se ve menos.
 *   - `--tinte` del CSS (styles/acrylic.css) es la veladura que la pagina
 *     pinta ENCIMA. Sube el numero y la UI se ve mas solida.
 * Son capas distintas y se suman. Si el vidrio se ve turbio, casi siempre
 * sobra la de CSS, no la de DWM.
 */

const DEFAULT_SETTINGS = {
  // --- Vidrio -------------------------------------------------------------
  // 'acrylic'        acrilico del sistema (Win11). Windows lo apaga solo
  //                  cuando la ventana pierde el foco: es su comportamiento.
  // 'acrylic-always' acrilico via SetWindowCompositionAttribute. Se mantiene
  //                  difuminado aunque la ventana no tenga el foco.
  // 'mica'           mica del sistema (tinta el fondo, difumina menos).
  // 'tabbed'         mica alternativa, un punto mas oscura.
  // 'none'           sin backdrop del sistema, la UI pinta su propio fondo.
  backdrop: 'acrylic',
  backdropTint: '#0E1116',
  backdropAlpha: 96, // 0..255, solo aplica en 'acrylic-always'

  // --- Color adaptativo ---------------------------------------------------
  adaptiveColor: true, // el tinte y el acento salen del fotograma de portada
  accentFallback: '#A78BFA',
  glassOpacity: 0.42, // veladura del CSS, la de ENCIMA

  // --- Reproduccion -------------------------------------------------------
  volume: 0.8,
  muted: false,
  repeat: 'off', // 'off' | 'all' | 'one'
  shuffle: false,
  playbackRate: 1,
  // 'contain' respeta el encuadre y deja bandas; 'cover' llena la ventana
  // recortando. Por defecto no se recorta: nadie quiere perder subtitulos
  // quemados en la parte de abajo sin haberlo pedido.
  encaje: 'contain',

  // --- Continuar donde lo dejaste -----------------------------------------
  resumePlayback: true,
  // Por debajo de este minuto no hay nada que reanudar: volver a los quince
  // segundos es mas molesto que empezar de cero.
  resumeMinSeconds: 60,
  // A menos de esto del final se considera visto y la proxima vez empieza
  // desde el principio, que es lo que se espera al repetir algo terminado.
  resumeEndMargin: 90,

  // --- Subtitulos ---------------------------------------------------------
  subtitlesEnabled: true,
  subtitleSize: 100, // porcentaje sobre el tamano base
  // Idioma preferido. Si una pista lo lleva en el nombre, se enciende sola.
  subtitleLanguage: 'es',

  // --- Pistas de audio ----------------------------------------------------
  audioLanguage: '',

  // --- Biblioteca ---------------------------------------------------------
  folders: [],
  sortBy: 'title',
  sortDir: 'asc',
  view: 'videos',
  sidebarCollapsed: false,
  queueOpen: false,
  // En video manda el doble clic. Un video ocupa la ventana entera, asi que
  // lanzarlo con un roce de raton mientras se busca otra cosa es mucho mas
  // molesto que en musica, donde solo cambia lo que suena de fondo.
  clickToPlay: false,
  // Videos escondidos, por id. El archivo NO se toca: esto solo decide que
  // no aparezca en la aplicacion, y se deshace entero.
  hiddenTracks: [],

  // --- Ventana ------------------------------------------------------------
  bounds: null,
  maximized: false,
  miniPlayer: false,

  // --- Sistema ------------------------------------------------------------
  minimizeToTray: false,
  showNotifications: true,
  mediaKeys: true,
  // Impide que la pantalla se apague mientras se esta viendo algo. En un
  // reproductor de musica no hace falta; en uno de video, sin esto la
  // pelicula se corta con el salvapantallas a la media hora.
  keepAwake: true,
};

/**
 * Contenedores que Chromium decodifica de verdad.
 *
 * Deliberadamente NO incluye avi, wmv, flv, mpg ni ts: se listarian en la UI
 * y luego darian pantalla negra. Es la misma regla que sigue Sounde con wma
 * y ape, y por el mismo motivo — es peor ensenar algo que no se puede abrir
 * que no ensenarlo.
 *
 * Dentro de estos contenedores tambien manda el codec: H.264, VP8, VP9 y AV1
 * van siempre; HEVC solo si la maquina lo decodifica por hardware; el audio
 * AC3 y DTS no va nunca, y eso se nota como un video que se ve pero no suena.
 */
const VIDEO_EXTENSIONS = ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.ogv'];

/**
 * Subtitulos sueltos junto al video.
 *
 * .ass y .ssa entran con sus tiempos y su texto, pero sin su tipografia ni
 * sus posiciones: eso es un motor de renderizado entero. Se avisa en la UI
 * para que nadie crea que el estilo se perdio por un fallo.
 */
const SUBTITLE_EXTENSIONS = ['.srt', '.vtt', '.ass', '.ssa'];

/** Velocidades del menu. La de 1 va marcada como "normal". */
const VELOCIDADES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

module.exports = { DEFAULT_SETTINGS, VIDEO_EXTENSIONS, SUBTITLE_EXTENSIONS, VELOCIDADES };
