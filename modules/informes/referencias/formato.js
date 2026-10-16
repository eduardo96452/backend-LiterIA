// modules/informes/referencias/formato.js
// Formato de las referencias y de las citas en el texto según la plantilla de la revisión
// (plantillas_formato.estilo_cita: apa7, ieee, vancouver, abnt o chicago) y el idioma del
// artículo. Funciones puras: reciben filas de la tabla `referencias` y devuelven texto.
//
// Cada referencia formateada se devuelve también en «partes» ([{ t, i?, b? }]) para que el Word
// pueda poner en cursiva (i) o negrita (b) lo que el estilo pide (revista, volumen, libro…).

const ESTILOS = ['apa7', 'ieee', 'vancouver', 'abnt', 'chicago'];
const NUMERICOS = new Set(['ieee', 'vancouver']);

const ETIQUETAS = {
  es: { y: 'y', sf: 's. f.', articulo: 'Artículo', en: 'En', enIeee: 'en', disponible: 'Disponible en', tesis: 'Tesis', informe: 'Informe' },
  en: { y: 'and', sf: 'n.d.', articulo: 'Article', en: 'In', enIeee: 'in', disponible: 'Available', tesis: 'Thesis', informe: 'Report' }
};

const normalizarEstilo = e => (ESTILOS.includes(String(e || '').toLowerCase()) ? String(e).toLowerCase() : 'apa7');
const normalizarIdioma = i => (i === 'en' ? 'en' : 'es');
const esNumerico = (estilo, citaEnTexto) =>
  citaEnTexto ? citaEnTexto === 'numerica' : NUMERICOS.has(normalizarEstilo(estilo));

const limpio = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const sinPuntoFinal = t => limpio(t).replace(/[.\s]+$/, '');
/** Título terminado en punto (o en ? / !, que ya cierran la frase). */
const conPunto = t => { const s = sinPuntoFinal(t); return s ? (/[?!]$/.test(s) ? s : `${s}.`) : ''; };
/** Título entre comillas con la puntuación dentro («"Título,"»), salvo que ya cierre con ? o !. */
const entreComillas = (t, signo) => { const s = sinPuntoFinal(t); return /[?!]$/.test(s) ? `"${s}"` : `"${s}${signo}"`; };
const rango = p => limpio(p).replace(/\s*[-–—]+\s*/g, '–');
const esRango = p => /[-–—]/.test(String(p || ''));

/* ---------- Autores ---------- */

/**
 * Texto de autores tal como se guarda en `estudios.autores` → [{ apellido, nombre }].
 * Formatos admitidos: «Pérez, Ana; López, M.» (RIS y APIs), «Pérez, A. and López, M.» (BibTeX),
 * «Kurniawan C., Rosmansyah Y.» (Scopus) y «Ana Pérez; Marco López».
 */
function parseAutores(texto) {
  const t = limpio(texto);
  if (!t) return [];
  let trozos;
  if (/;|\sand\s/i.test(t)) trozos = t.split(/\s*;\s*|\s+and\s+/i);
  else if (/[A-Z]\.,\s/.test(t)) trozos = t.split(/(?<=[A-Z]\.),\s+/);        // Scopus: «Kurniawan C., Rosmansyah Y.»
  else trozos = [t];

  return trozos.map(limpio).filter(Boolean).map(a => {
    if (a.includes(',')) {
      const [apellido, ...resto] = a.split(',');
      return { apellido: limpio(apellido), nombre: limpio(resto.join(',')) };
    }
    const partes = a.split(' ');
    if (partes.length === 1) return { apellido: a, nombre: '' };
    // «Kurniawan C.» o «Kurniawan C.J.»: las iniciales van detrás
    if (/^([A-ZÁÉÍÓÚÑ]\.?-?)+$/.test(partes.at(-1))) {
      return { apellido: partes.slice(0, -1).join(' '), nombre: partes.at(-1) };
    }
    return { apellido: partes.at(-1), nombre: partes.slice(0, -1).join(' ') };
  }).filter(a => a.apellido);
}

/** «Juan Carlos» → «J. C.»; «Jean-Paul» → «J.-P.»; «J.C.» → «J. C.». */
function iniciales(nombre, { puntos = true, espacios = true } = {}) {
  const n = limpio(nombre);
  if (!n) return '';
  const palabras = n.replace(/\./g, '. ').split(/\s+/).filter(Boolean);
  const ini = palabras.map(p => p.split('-').filter(Boolean)
    .map(s => s[0].toUpperCase() + (puntos ? '.' : '')).join('-'));
  return ini.join(espacios ? ' ' : '');
}

const autoresDe = ref => (Array.isArray(ref.autores) ? ref.autores : [])
  .map(a => ({ apellido: limpio(a?.apellido), nombre: limpio(a?.nombre) }))
  .filter(a => a.apellido);

/** Une una lista con comas y la conjunción final: [A, B, C] → «A, B y C» o «A, B, & C». */
function unir(lista, conjuncion, comaSerial) {
  if (lista.length <= 1) return lista.join('');
  if (lista.length === 2) return `${lista[0]}${comaSerial === 'siempre' ? ',' : ''} ${conjuncion} ${lista[1]}`;
  return `${lista.slice(0, -1).join(', ')}${comaSerial ? ',' : ''} ${conjuncion} ${lista.at(-1)}`;
}

/* ---------- Listas de autores por estilo ---------- */

function autoresApa(autores, idioma) {
  const uno = a => (a.nombre ? `${a.apellido}, ${iniciales(a.nombre)}` : a.apellido);
  if (!autores.length) return '';
  if (autores.length > 20) {
    return `${autores.slice(0, 19).map(uno).join(', ')}, ${ELIPSIS} ${uno(autores.at(-1))}`;
  }
  const lista = autores.map(uno);
  // APA en inglés: «A., & B.» (coma también con dos); en español: «A. y B.»
  return idioma === 'en' ? unir(lista, '&', 'siempre') : unir(lista, 'y', false);
}

function autoresIeee(autores, idioma) {
  const uno = a => [iniciales(a.nombre), a.apellido].filter(Boolean).join(' ');
  if (!autores.length) return '';
  if (autores.length > 6) return `${uno(autores[0])} et al.`;
  return unir(autores.map(uno), ETIQUETAS[idioma].y, idioma === 'en');
}

function autoresVancouver(autores) {
  const uno = a => [a.apellido, iniciales(a.nombre, { puntos: false, espacios: false })].filter(Boolean).join(' ');
  if (!autores.length) return '';
  const lista = autores.slice(0, 6).map(uno).join(', ');
  return autores.length > 6 ? `${lista}, et al` : lista;
}

function autoresAbnt(autores) {
  const uno = a => [a.apellido.toUpperCase(), iniciales(a.nombre)].filter(Boolean).join(', ');
  if (!autores.length) return '';
  if (autores.length > 3) return `${uno(autores[0])} et al.`;
  return autores.map(uno).join('; ');
}

function autoresChicago(autores, idioma) {
  if (!autores.length) return '';
  const primero = a => (a.nombre ? `${a.apellido}, ${a.nombre}` : a.apellido);
  const resto = a => [a.nombre, a.apellido].filter(Boolean).join(' ');
  const lista = autores.length > 10 ? autores.slice(0, 7) : autores;
  const textos = lista.map((a, i) => (i === 0 ? primero(a) : resto(a)));
  // «Grazer, Brian, and Charles Fishman»: con dos autores la coma separa el nombre invertido
  const base = unir(textos, ETIQUETAS[idioma].y, textos.length === 2 ? 'siempre' : idioma === 'en');
  return autores.length > 10 ? `${textos.join(', ')}, et al.` : base;
}

/* ---------- Referencia completa ---------- */

const doiUrl = ref => (limpio(ref.doi) ? `https://doi.org/${limpio(ref.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')}` : '');
const enlace = ref => doiUrl(ref) || limpio(ref.url);

/** Partes → texto, quitando espacios dobles y puntos repetidos que dejan los campos vacíos. */
function cerrar(partes) {
  const limpias = partes.filter(p => p && p.t !== '').map(p => ({ ...p, t: String(p.t) }));
  // Colapsa espacios entre partes contiguas
  for (let i = 1; i < limpias.length; i++) {
    if (/\s$/.test(limpias[i - 1].t) && /^\s/.test(limpias[i].t)) limpias[i].t = limpias[i].t.replace(/^\s+/, '');
  }
  const texto = limpias.map(p => p.t).join('').replace(/\s+/g, ' ').replace(/\.\./g, '.').replace(/,\s*\./g, '.')
    .split(ELIPSIS).join('. . .').trim();
  for (const p of limpias) p.t = p.t.split(ELIPSIS).join('. . .');
  return { texto, partes: limpias };
}

const p = (t, extra = {}) => ({ t, ...extra });
/** Marca de los puntos suspensivos de APA («. . .»), para que la limpieza de puntos no los toque. */
const ELIPSIS = '\u0001';

function apa(ref, idioma) {
  const L = ETIQUETAS[idioma];
  const autores = autoresApa(autoresDe(ref), idioma);
  const anio = ref.anio ? String(ref.anio) : L.sf;
  const titulo = limpio(ref.titulo);
  const revista = limpio(ref.revista);
  const tipo = ref.tipo || 'article';
  const pags = limpio(ref.paginas);
  const enl = enlace(ref);
  const cabeza = autores ? [p(`${autores} (${anio}). `)] : [p(`${conPunto(titulo)} (${anio}). `)];
  const tituloTxt = autores ? conPunto(titulo) : '';
  const fin = enl ? [p(` ${enl}`)] : [];

  if (tipo === 'book' || tipo === 'thesis' || tipo === 'report' || tipo === 'web') {
    const extra = tipo === 'thesis' ? ` [${L.tesis}]` : (tipo === 'report' && limpio(ref.numero) ? ` (${limpio(ref.numero)})` : '');
    return cerrar([...cabeza, ...(autores ? [p(sinPuntoFinal(titulo), { i: true })] : []), p(`${extra}.`),
      ...(limpio(ref.editorial) ? [p(` ${conPunto(ref.editorial)}`)] : []), ...fin]);
  }
  if (tipo === 'conference' || tipo === 'chapter') {
    return cerrar([...cabeza, p(tituloTxt ? `${tituloTxt} ` : ''),
      ...(revista ? [p(`${L.en} `), p(sinPuntoFinal(revista), { i: true }), p(pags ? ` (pp. ${rango(pags)}).` : '.')] : []),
      ...(limpio(ref.editorial) ? [p(` ${conPunto(ref.editorial)}`)] : []), ...fin]);
  }
  // Artículo (y preprint u otros con revista)
  const partes = [...cabeza, p(tituloTxt)];
  if (revista) {
    partes.push(p(' '), p(sinPuntoFinal(revista), { i: true }));
    if (limpio(ref.volumen)) partes.push(p(', '), p(limpio(ref.volumen), { i: true }));
    if (limpio(ref.numero)) partes.push(p(`(${limpio(ref.numero)})`));
    if (pags) partes.push(p(esRango(pags) ? `, ${rango(pags)}` : `, ${L.articulo} ${pags}`));
    partes.push(p('.'));
  }
  return cerrar([...partes, ...fin]);
}

function ieee(ref, idioma) {
  const L = ETIQUETAS[idioma];
  const autores = autoresIeee(autoresDe(ref), idioma);
  const titulo = sinPuntoFinal(ref.titulo);
  const revista = sinPuntoFinal(ref.revista);
  const tipo = ref.tipo || 'article';
  const anio = ref.anio ? String(ref.anio) : L.sf;
  const pags = limpio(ref.paginas);
  const cola = [];
  if (limpio(ref.doi)) cola.push(p(`, doi: ${limpio(ref.doi)}.`));
  else if (limpio(ref.url)) cola.push(p(`. [Online]. ${L.disponible}: ${limpio(ref.url)}`));
  else cola.push(p('.'));
  const pre = autores ? [p(`${autores}, `)] : [];

  if (tipo === 'book') {
    return cerrar([...pre, p(titulo, { i: true }), p('. '), p(limpio(ref.editorial) ? `${limpio(ref.editorial)}, ` : ''), p(anio), ...cola]);
  }
  if (tipo === 'report' || tipo === 'thesis' || tipo === 'web') {
    return cerrar([...pre, p(`${entreComillas(titulo, ',')} `), p(limpio(ref.editorial) ? `${limpio(ref.editorial)}, ` : ''),
      p(limpio(ref.numero) ? `${limpio(ref.numero)}, ` : ''), p(anio), ...cola]);
  }
  const partes = [...pre, p(`${entreComillas(titulo, ',')} `)];
  if (tipo === 'conference' || tipo === 'chapter') {
    if (revista) partes.push(p(`${L.enIeee} `), p(revista, { i: true }), p(', '));
    partes.push(p(anio));
    if (pags) partes.push(p(esRango(pags) ? `, pp. ${rango(pags)}` : `, Art. no. ${pags}`));
    return cerrar([...partes, ...cola]);
  }
  if (revista) partes.push(p(revista, { i: true }), p(', '));
  if (limpio(ref.volumen)) partes.push(p(`vol. ${limpio(ref.volumen)}, `));
  if (limpio(ref.numero)) partes.push(p(`no. ${limpio(ref.numero)}, `));
  if (pags) partes.push(p(esRango(pags) ? `pp. ${rango(pags)}, ` : `Art. no. ${pags}, `));
  partes.push(p(anio));
  return cerrar([...partes, ...cola]);
}

function vancouver(ref, idioma) {
  const L = ETIQUETAS[idioma];
  const autores = autoresVancouver(autoresDe(ref));
  const titulo = conPunto(ref.titulo);
  const anio = ref.anio ? String(ref.anio) : L.sf;
  const revista = sinPuntoFinal(ref.revista);
  const tipo = ref.tipo || 'article';
  const doi = limpio(ref.doi) ? ` doi:${limpio(ref.doi)}` : (limpio(ref.url) ? ` ${L.disponible}: ${limpio(ref.url)}` : '');
  const pre = autores ? `${autores}. ` : '';
  if (tipo !== 'article' || !revista) {
    const fuente = revista || sinPuntoFinal(ref.editorial);
    return cerrar([p(`${pre}${titulo} ${fuente ? `${fuente}; ` : ''}${anio}.${doi}`)]);
  }
  let detalle = anio;
  if (limpio(ref.volumen)) detalle += `;${limpio(ref.volumen)}`;
  if (limpio(ref.numero)) detalle += `(${limpio(ref.numero)})`;
  if (limpio(ref.paginas)) detalle += `:${rango(ref.paginas)}`;
  return cerrar([p(`${pre}${titulo} ${revista}. ${detalle}.${doi}`)]);
}

function abnt(ref, idioma) {
  const L = ETIQUETAS[idioma];
  const autores = autoresAbnt(autoresDe(ref));
  const titulo = sinPuntoFinal(ref.titulo);
  const revista = sinPuntoFinal(ref.revista);
  const anio = ref.anio ? String(ref.anio) : L.sf;
  const tipo = ref.tipo || 'article';
  const pre = autores ? [p(`${conPunto(autores)} `)] : [];
  const doi = limpio(ref.doi) ? [p(` DOI: ${limpio(ref.doi)}.`)] : (limpio(ref.url) ? [p(` ${L.disponible}: ${limpio(ref.url)}.`)] : []);
  if (tipo === 'book' || !revista) {
    return cerrar([...pre, p(titulo, { b: true }), p('. '), p(limpio(ref.editorial) ? `${limpio(ref.editorial)}, ` : ''), p(`${anio}.`), ...doi]);
  }
  const partes = [...pre, p(`${conPunto(titulo)} `)];
  if (tipo === 'conference' || tipo === 'chapter') partes.push(p('In: '));
  partes.push(p(revista, { b: true }));
  if (limpio(ref.volumen)) partes.push(p(`, v. ${limpio(ref.volumen)}`));
  if (limpio(ref.numero)) partes.push(p(`, n. ${limpio(ref.numero)}`));
  if (limpio(ref.paginas)) partes.push(p(`, p. ${rango(ref.paginas)}`));
  partes.push(p(`, ${anio}.`));
  return cerrar([...partes, ...doi]);
}

function chicago(ref, idioma) {
  const L = ETIQUETAS[idioma];
  const autores = autoresChicago(autoresDe(ref), idioma);
  const titulo = sinPuntoFinal(ref.titulo);
  const revista = sinPuntoFinal(ref.revista);
  const anio = ref.anio ? String(ref.anio) : L.sf;
  const tipo = ref.tipo || 'article';
  const enl = enlace(ref);
  const pre = autores ? [p(`${conPunto(autores)} ${anio}. `)] : [p(`${anio}. `)];
  const fin = enl ? [p(` ${enl}.`)] : [];
  if (tipo === 'book' || tipo === 'report' || tipo === 'thesis') {
    return cerrar([...pre, p(titulo, { i: true }), p('.'), p(limpio(ref.editorial) ? ` ${conPunto(ref.editorial)}` : ''), ...fin]);
  }
  const partes = [...pre, p(`${entreComillas(titulo, '.')} `)];
  if (revista) {
    if (tipo === 'conference' || tipo === 'chapter') partes.push(p(`${L.en} `));
    partes.push(p(revista, { i: true }));
    if (limpio(ref.volumen)) partes.push(p(` ${limpio(ref.volumen)}`));
    if (limpio(ref.numero)) partes.push(p(` (${limpio(ref.numero)})`));
    if (limpio(ref.paginas)) partes.push(p(`: ${rango(ref.paginas)}`));
    partes.push(p('.'));
  }
  return cerrar([...partes, ...fin]);
}

const FORMATOS = { apa7: apa, ieee, vancouver, abnt, chicago };

/** Referencia completa → { texto, partes }. */
function formatear(ref, { estilo, idioma } = {}) {
  return FORMATOS[normalizarEstilo(estilo)](ref || {}, normalizarIdioma(idioma));
}

/* ---------- Citas en el texto ---------- */

/** Autor corto para la cita: «Lo», «Crompton y Burke», «Zawacki-Richter et al.». */
function autorCorto(ref, { estilo, idioma, parentetica = false } = {}) {
  const e = normalizarEstilo(estilo);
  const i = normalizarIdioma(idioma);
  const autores = autoresDe(ref);
  if (!autores.length) {
    const palabras = sinPuntoFinal(ref.titulo).split(' ').slice(0, 4).join(' ');
    return `«${palabras}${sinPuntoFinal(ref.titulo).split(' ').length > 4 ? '…' : ''}»`;
  }
  const ap = a => (e === 'abnt' && parentetica ? a.apellido.toUpperCase() : a.apellido);
  if (autores.length === 1) return ap(autores[0]);
  if (e === 'abnt') {
    if (autores.length > 3) return `${ap(autores[0])} et al.`;
    return parentetica ? autores.map(ap).join('; ') : unir(autores.map(ap), i === 'en' ? 'and' : 'y', false);
  }
  if (e === 'chicago') {
    if (autores.length >= 4) return `${ap(autores[0])} et al.`;
    return unir(autores.map(ap), ETIQUETAS[i].y, i === 'en' && autores.length > 2);
  }
  if (autores.length === 2) {
    const conj = e === 'apa7' && parentetica && i === 'en' ? '&' : ETIQUETAS[i].y;
    return `${ap(autores[0])} ${conj} ${ap(autores[1])}`;
  }
  return `${ap(autores[0])} et al.`;
}

/**
 * Formas de cita de una referencia. `anio` puede venir con letra (2023a) cuando dos obras del
 * mismo autor y año aparecen en la lista.
 */
function formasDeCita(ref, { estilo, idioma, anio } = {}) {
  const e = normalizarEstilo(estilo);
  const i = normalizarIdioma(idioma);
  const a = anio || (ref.anio ? String(ref.anio) : ETIQUETAS[i].sf);
  const autorP = autorCorto(ref, { estilo: e, idioma: i, parentetica: true });
  const autorN = autorCorto(ref, { estilo: e, idioma: i });
  return {
    autor: autorN,
    parentetica: e === 'chicago' ? `${autorP} ${a}` : `${autorP}, ${a}`,
    narrativa: `${autorN} (${a})`
  };
}

/** Clave de orden alfabético (apellidos de todos los autores, año y título), sin acentos. */
function claveOrden(ref) {
  const quitar = s => limpio(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const autores = autoresDe(ref).map(a => `${quitar(a.apellido)} ${quitar(a.nombre)}`).join(' ');
  return `${autores || quitar(ref.titulo)}|${ref.anio ?? 9999}|${quitar(ref.titulo)}`;
}

/**
 * Años con letra cuando hay varias obras con el mismo autor de cita y el mismo año
 * («Lo, 2023a» y «Lo, 2023b»), ordenadas por título. Devuelve Map(id_referencia → año).
 */
function aniosConLetra(refs, { estilo, idioma } = {}) {
  const i = normalizarIdioma(idioma);
  const grupos = new Map();
  for (const r of refs) {
    const clave = `${autorCorto(r, { estilo, idioma: i, parentetica: true })}|${r.anio ?? ''}`;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(r);
  }
  const out = new Map();
  for (const lista of grupos.values()) {
    const base = r => (r.anio ? String(r.anio) : ETIQUETAS[i].sf);
    if (lista.length === 1) { out.set(lista[0].id_referencia, base(lista[0])); continue; }
    lista.sort((a, b) => limpio(a.titulo).localeCompare(limpio(b.titulo), i));
    lista.forEach((r, n) => out.set(r.id_referencia, `${base(r)}${r.anio ? '' : '-'}${String.fromCharCode(97 + (n % 26))}`));
  }
  return out;
}

module.exports = {
  ESTILOS, normalizarEstilo, normalizarIdioma, esNumerico,
  parseAutores, iniciales, formatear, autorCorto, formasDeCita, claveOrden, aniosConLetra
};
