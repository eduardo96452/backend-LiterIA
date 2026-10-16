// modules/informes/referencias/registro.js
// Registro único de referencias de la revisión (tabla `referencias`, sql/010). De aquí salen todas
// las citas del artículo: los estudios incluidos, las fuentes que la IA usa en Trabajos relacionados,
// Introducción y Discusión (de Consensus, origen 'ia', o de CrossRef) y las guías metodológicas (PRISMA 2020).
// Cada referencia tiene una clave estable (lo2023) que es lo que escribe la IA: [@lo2023].
const sb = require('../../../infra/supabase');
const { HttpError } = require('../../../core/httpError');
const F = require('./formato');

const COLS = 'id_referencia, clave, id_estudios, doi, titulo, autores, anio, revista, volumen, numero, paginas, ' +
  'editorial, url, issn, isbn, tipo, origen, verificada, datos_crossref';

const FALTA_SQL = 'Para redactar con referencias de la base falta ejecutar sql/010_redaccion.sql en Supabase.';

/** ¿El error es una columna que no existe? (sql/010 sin ejecutar) */
const faltaColumna = e => e?.code === '42703' || e?.code === 'PGRST204' || /column .* does not exist|could not find the '.*' column/i.test(e?.message || '');

const cliente = token => sb.forUser(token);
function datos({ data, error }) {
  if (error) {
    if (faltaColumna(error)) throw new HttpError(409, FALTA_SQL);
    throw sb.fromSupabaseError(error);
  }
  return data;
}

/* ---------- Guías metodológicas que se citan en Metodología ---------- */

const PRISMA_2020 = {
  titulo: 'The PRISMA 2020 statement: An updated guideline for reporting systematic reviews',
  autores: [
    ['Page', 'Matthew J.'], ['McKenzie', 'Joanne E.'], ['Bossuyt', 'Patrick M.'], ['Boutron', 'Isabelle'],
    ['Hoffmann', 'Tammy C.'], ['Mulrow', 'Cynthia D.'], ['Shamseer', 'Larissa'], ['Tetzlaff', 'Jennifer M.'],
    ['Akl', 'Elie A.'], ['Brennan', 'Sue E.'], ['Chou', 'Roger'], ['Glanville', 'Julie'], ['Grimshaw', 'Jeremy M.'],
    ['Hróbjartsson', 'Asbjørn'], ['Lalu', 'Manoj M.'], ['Li', 'Tianjing'], ['Loder', 'Elizabeth W.'],
    ['Mayo-Wilson', 'Evan'], ['McDonald', 'Steve'], ['McGuinness', 'Luke A.'], ['Stewart', 'Lesley A.'],
    ['Thomas', 'James'], ['Tricco', 'Andrea C.'], ['Welch', 'Vivian A.'], ['Whiting', 'Penny'], ['Moher', 'David']
  ].map(([apellido, nombre]) => ({ apellido, nombre })),
  anio: 2021, revista: 'BMJ', volumen: '372', paginas: 'n71', doi: '10.1136/bmj.n71', tipo: 'article'
};

const KITCHENHAM_2007 = {
  titulo: 'Guidelines for performing systematic literature reviews in software engineering',
  autores: [{ apellido: 'Kitchenham', nombre: 'Barbara' }, { apellido: 'Charters', nombre: 'Stuart' }],
  anio: 2007, numero: 'EBSE Technical Report EBSE-2007-01', editorial: 'Keele University and Durham University', tipo: 'report'
};

/* ---------- Lectura ---------- */

async function filas(token, idRev) {
  return datos(await cliente(token).from('referencias').select(COLS)
    .eq('id_detalles_revision', idRev).order('id_referencia')) || [];
}

/** Formato de cita de la revisión (plantillas_formato). Sin plantilla: APA 7, autor-año. */
async function plantilla(token, revision) {
  const id = revision?.id_plantilla;
  if (!id) return { estilo: 'apa7', cita_en_texto: 'autor_anio', nombre: null };
  const { data, error } = await cliente(token).from('plantillas_formato')
    .select('nombre, estilo_cita, cita_en_texto').eq('id_plantilla', id).maybeSingle();
  if (error || !data) return { estilo: 'apa7', cita_en_texto: 'autor_anio', nombre: null };
  return {
    estilo: F.normalizarEstilo(data.estilo_cita),
    cita_en_texto: data.cita_en_texto === 'numerica' ? 'numerica' : 'autor_anio',
    nombre: data.nombre
  };
}

/** Idioma del artículo (detalles_revision.idioma_redaccion). Sin sql/010 → español. */
async function idioma(token, idRev) {
  const { data, error } = await cliente(token).from('detalles_revision')
    .select('idioma_redaccion').eq('id_detalles_revision', idRev).maybeSingle();
  if (error) return 'es';
  return F.normalizarIdioma(data?.idioma_redaccion);
}

async function cambiarIdioma(token, idRev, nuevo) {
  const { data, error } = await cliente(token).from('detalles_revision')
    .update({ idioma_redaccion: F.normalizarIdioma(nuevo) }).eq('id_detalles_revision', idRev)
    .select('idioma_redaccion').maybeSingle();
  if (error) {
    if (faltaColumna(error)) throw new HttpError(409, FALTA_SQL);
    throw sb.fromSupabaseError(error);
  }
  if (!data) throw new HttpError(403, 'No tienes permiso para editar esta revisión.');
  return data.idioma_redaccion;
}

/* ---------- Altas ---------- */

const doiLimpio = d => String(d || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase() || null;

function tipoDeEstudio(e) {
  const t = String(e.document_type || '').toLowerCase();
  if (/conference|proceeding/.test(t)) return 'conference';
  if (/chapter/.test(t)) return 'chapter';
  if (/book/.test(t)) return 'book';
  if (/thesis|tesis/.test(t)) return 'thesis';
  if (/preprint/.test(t)) return 'preprint';
  return 'article';
}

const filaDeEstudio = (idRev, e) => ({
  id_detalles_revision: idRev,
  id_estudios: e.id_estudios,
  doi: doiLimpio(e.doi),
  titulo: String(e.titulo || 'Sin título').trim(),
  autores: F.parseAutores(e.autores),
  anio: Number(e.anio) || null,
  revista: e.revista || null,
  volumen: e.volumen || null,
  paginas: e.paginas || null,
  editorial: e.publisher || null,
  url: e.url || null,
  issn: e.issn || null,
  tipo: tipoDeEstudio(e),
  origen: 'estudio',
  verificada: doiLimpio(e.doi) ? 'pendiente' : 'sin_doi'
});

async function insertar(token, nuevas) {
  if (!nuevas.length) return [];
  return datos(await cliente(token).from('referencias').insert(nuevas).select(COLS)) || [];
}

/**
 * Asegura que cada estudio incluido tenga su referencia. Si ya había una con el mismo DOI (por
 * ejemplo, añadida desde CrossRef), se enlaza al estudio en vez de duplicarla.
 * Devuelve las filas del registro actualizadas.
 */
async function asegurarEstudios(token, idRev, incluidos, actuales) {
  let lista = actuales ?? await filas(token, idRev);
  const porEstudio = new Set(lista.filter(r => r.id_estudios).map(r => Number(r.id_estudios)));
  const porDoi = new Map(lista.filter(r => r.doi).map(r => [doiLimpio(r.doi), r]));
  const nuevas = [];
  for (const e of incluidos) {
    if (porEstudio.has(Number(e.id_estudios))) continue;
    const previa = porDoi.get(doiLimpio(e.doi));
    if (previa && !previa.id_estudios) {
      datos(await cliente(token).from('referencias').update({ id_estudios: e.id_estudios, origen: 'estudio' })
        .eq('id_referencia', previa.id_referencia).select('id_referencia'));
      previa.id_estudios = e.id_estudios;
      previa.origen = 'estudio';
      continue;
    }
    if (previa) continue;                       // otro estudio con el mismo DOI ya la tiene
    const fila = filaDeEstudio(idRev, e);
    if (fila.doi) porDoi.set(fila.doi, fila);
    nuevas.push(fila);
  }
  if (nuevas.length) lista = [...lista, ...(await insertar(token, nuevas))];
  return lista;
}

/** Añade PRISMA 2020 (y, si se pide, Kitchenham y Charters) si aún no están. */
async function asegurarGuias(token, idRev, actuales, { kitchenham = false } = {}) {
  const lista = actuales ?? await filas(token, idRev);
  const nuevas = [];
  if (!lista.some(r => doiLimpio(r.doi) === PRISMA_2020.doi)) {
    nuevas.push({ ...PRISMA_2020, id_detalles_revision: idRev, origen: 'manual', verificada: 'verificada' });
  }
  if (kitchenham && !lista.some(r => /guidelines for performing systematic literature reviews/i.test(r.titulo || ''))) {
    nuevas.push({ ...KITCHENHAM_2007, id_detalles_revision: idRev, origen: 'manual', verificada: 'sin_doi' });
  }
  return nuevas.length ? [...lista, ...(await insertar(token, nuevas))] : lista;
}

/** Ítem de CrossRef → fila del registro, con la relevancia calculada al buscarlo. */
function filaDeCrossref(idRev, item, extra = {}) {
  const anio = item?.issued?.['date-parts']?.[0]?.[0] ?? item?.['published-print']?.['date-parts']?.[0]?.[0] ?? null;
  const tipo = { 'journal-article': 'article', 'proceedings-article': 'conference', 'book-chapter': 'chapter', book: 'book', 'posted-content': 'preprint' }[item?.type] || 'article';
  return {
    id_detalles_revision: idRev,
    doi: doiLimpio(item?.DOI),
    titulo: String(item?.title?.[0] || 'Sin título').trim(),
    autores: (item?.author || []).map(a => ({ apellido: a.family || a.name || '', nombre: a.given || '' })).filter(a => a.apellido),
    anio: Number(anio) || null,
    revista: item?.['container-title']?.[0] || null,
    volumen: item?.volume || null,
    numero: item?.issue || null,
    paginas: item?.page || item?.['article-number'] || null,
    editorial: item?.publisher || null,
    url: item?.URL || null,
    issn: item?.ISSN?.[0] || null,
    tipo,
    origen: 'crossref',
    verificada: 'verificada',
    datos_crossref: extra
  };
}

/** Añade las fuentes de CrossRef que aún no estén (por DOI). Devuelve el registro y las claves de esas fuentes. */
async function agregarCrossref(token, idRev, candidatos, actuales) {
  let lista = actuales ?? await filas(token, idRev);
  const porDoi = new Map(lista.filter(r => r.doi).map(r => [doiLimpio(r.doi), r]));
  const nuevas = [];
  for (const c of candidatos) {
    const fila = filaDeCrossref(idRev, c.item, { relevancia: c.relevancia, coincidencias: c.coincidencias, resumen: c.resumen, consulta: c.consulta });
    if (!fila.doi || porDoi.has(fila.doi)) continue;
    porDoi.set(fila.doi, fila);
    nuevas.push(fila);
  }
  if (nuevas.length) lista = [...lista, ...(await insertar(token, nuevas))];
  const doisPedidos = new Set(candidatos.map(c => doiLimpio(c.item?.DOI)).filter(Boolean));
  return { lista, claves: lista.filter(r => doisPedidos.has(doiLimpio(r.doi))).map(r => r.clave) };
}

/**
 * Añade filas ya armadas (p. ej., las fuentes de Consensus que la IA citó) que aún no estén por DOI.
 * Devuelve { lista } con el registro actualizado (las claves las pone la base).
 */
async function agregarFilas(token, idRev, nuevasFilas, actuales) {
  let lista = actuales ?? await filas(token, idRev);
  const porDoi = new Set(lista.filter(r => r.doi).map(r => doiLimpio(r.doi)));
  const nuevas = [];
  for (const f of nuevasFilas) {
    const doi = doiLimpio(f.doi);
    if (doi && porDoi.has(doi)) continue;
    if (doi) porDoi.add(doi);
    nuevas.push({ ...f, doi, id_detalles_revision: idRev });
  }
  if (nuevas.length) lista = [...lista, ...(await insertar(token, nuevas))];
  return { lista };
}

/** Añade la referencia de ese DOI. null si ya estaba en el registro (la ruta responde 409). */
async function agregarPorDoi(token, idRev, item) {
  const actuales = await filas(token, idRev);
  const doi = doiLimpio(item?.DOI);
  if (!doi || actuales.some(r => doiLimpio(r.doi) === doi)) return null;
  // origen 'manual': la añadió el usuario (las 'crossref' son las que encontró la IA)
  const fila = { ...filaDeCrossref(idRev, item, { relevancia: null, coincidencias: [], resumen: null, consulta: 'doi' }), origen: 'manual' };
  return (await insertar(token, [fila]))[0] ?? null;
}

async function borrar(token, idRev, idRef) {
  const filasBorradas = datos(await cliente(token).from('referencias').delete()
    .eq('id_referencia', idRef).eq('id_detalles_revision', idRev).select('id_referencia'));
  if (!(filasBorradas || []).length) throw new HttpError(404, 'Referencia no encontrada.');
}

/* ---------- Vista para la pantalla y el Word ---------- */

/**
 * Registro listo para mostrar: cada referencia con su texto en el formato de la plantilla, sus
 * formas de cita y la clave de orden alfabético. La numeración de los estilos numéricos la pone
 * la pantalla según el orden en que aparece cada cita en el artículo.
 */
function vista(lista, { estilo, cita_en_texto: citaEnTexto, idioma }) {
  const anios = F.aniosConLetra(lista, { estilo, idioma });
  return lista.map(r => {
    const { texto, partes } = F.formatear(r, { estilo, idioma });
    return {
      id_referencia: r.id_referencia,
      clave: r.clave,
      id_estudios: r.id_estudios ?? null,
      origen: r.origen,
      verificada: r.verificada,
      doi: r.doi,
      titulo: r.titulo,
      anio: r.anio,
      relevancia: r.datos_crossref?.relevancia ?? null,
      coincidencias: r.datos_crossref?.coincidencias ?? null,
      // Fuentes de Consensus: de dónde salió, su ficha y la conclusión principal del artículo
      fuente: r.datos_crossref?.fuente ?? null,
      url_fuente: r.datos_crossref?.fuente === 'consensus' ? (r.datos_crossref?.url ?? null) : null,
      conclusion: r.datos_crossref?.takeaway ?? null,
      referencia: texto,
      partes,
      cita: F.formasDeCita(r, { estilo, idioma, anio: anios.get(r.id_referencia) }),
      orden: F.claveOrden(r),
      numerica: F.esNumerico(estilo, citaEnTexto)
    };
  });
}

module.exports = {
  COLS, FALTA_SQL, PRISMA_2020, KITCHENHAM_2007, faltaColumna, doiLimpio,
  filas, plantilla, idioma, cambiarIdioma, asegurarEstudios, asegurarGuias, agregarCrossref, agregarFilas, agregarPorDoi, borrar,
  vista, filaDeEstudio, filaDeCrossref
};
