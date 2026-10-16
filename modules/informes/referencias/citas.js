// modules/informes/referencias/citas.js
// Citas por clave dentro del texto del artículo. La IA (y quien escribe) cita así:
//   [@lo2023]               cita entre paréntesis      → (Lo, 2023)  o  [3]
//   [@lo2023; @burke2023]   varias                     → (Burke, 2023; Lo, 2023)  o  [3], [5]
//   @lo2023 sostiene…       narrativa (autor de sujeto) → Lo (2023) sostiene…  o  Lo [3] sostiene…
// La forma final la pone la aplicación con la plantilla de la revisión. Aquí solo se leen,
// se validan contra el registro y se quitan las claves que no existen (la IA no puede colar
// una referencia inventada).

// Las claves reales son [a-z0-9_-], pero se lee cualquier letra (la IA a veces escribe «@pérez2021»)
// para poder quitarla entera si no existe.
const CLAVE = '[\\p{L}\\p{N}][\\p{L}\\p{N}_-]*';
const RE_GRUPO = new RegExp(`\\[\\s*(@${CLAVE}(?:\\s*[;,]\\s*@${CLAVE})*)\\s*\\]`, 'giu');
// Narrativa: «@clave» que no va pegada a una palabra (así no se confunde con un correo)
const RE_NARRATIVA = new RegExp(`(^|[^\\p{L}\\p{N}_@\\[.])@(${CLAVE})`, 'giu');

const normalizar = c => String(c || '').trim().replace(/^@/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Claves citadas en un texto, en orden de primera aparición y sin repetir. */
function clavesEn(texto) {
  const t = String(texto ?? '');
  const marcas = [];
  for (const m of t.matchAll(RE_GRUPO)) {
    for (const c of m[1].split(/[;,]/)) marcas.push({ pos: m.index, clave: normalizar(c) });
  }
  const sinGrupos = t.replace(RE_GRUPO, s => ' '.repeat(s.length));
  for (const m of sinGrupos.matchAll(RE_NARRATIVA)) marcas.push({ pos: m.index + m[1].length, clave: normalizar(m[2]) });
  marcas.sort((a, b) => a.pos - b.pos);
  return [...new Set(marcas.map(m => m.clave).filter(Boolean))];
}

/** Recorre cualquier valor (texto, lista u objeto de una sección) y junta sus claves. */
function clavesDe(valor) {
  if (valor == null) return [];
  if (typeof valor === 'string') return clavesEn(valor);
  if (Array.isArray(valor)) return [...new Set(valor.flatMap(clavesDe))];
  if (typeof valor === 'object') return [...new Set(Object.values(valor).flatMap(clavesDe))];
  return [];
}

/**
 * Deja en el texto solo las claves permitidas. Devuelve { texto, usadas, quitadas }.
 * También corrige variantes de la IA: «[@a, @b]» → «[@a; @b]», «[ @a ]» → «[@a]».
 */
function validarCitas(texto, permitidas) {
  const ok = new Set([...permitidas].map(normalizar));
  const quitadas = new Set();
  let t = String(texto ?? '');

  t = t.replace(RE_GRUPO, (_, dentro) => {
    const claves = dentro.split(/[;,]/).map(normalizar).filter(Boolean);
    const buenas = [...new Set(claves.filter(c => ok.has(c)))];
    claves.filter(c => !ok.has(c)).forEach(c => quitadas.add(c));
    return buenas.length ? `[${buenas.map(c => `@${c}`).join('; ')}]` : '';
  });
  t = t.replace(RE_NARRATIVA, (todo, antes, clave) => {
    const c = normalizar(clave);
    if (ok.has(c)) return `${antes}@${c}`;
    quitadas.add(c);
    return antes;                       // sin autor reconocible, mejor no dejar nada
  });
  // Restos de una cita quitada: espacios antes de la puntuación, paréntesis vacíos, dobles espacios
  t = t.replace(/\(\s*\)/g, '').replace(/[ \t]+([.,;:])/g, '$1').replace(/[ \t]{2,}/g, ' ');

  return { texto: t, usadas: clavesEn(t), quitadas: [...quitadas] };
}

/** validarCitas sobre un valor cualquiera (texto, lista de párrafos u objeto). */
function validarEnValor(valor, permitidas, acumulado = { usadas: new Set(), quitadas: new Set() }) {
  if (typeof valor === 'string') {
    const r = validarCitas(valor, permitidas);
    r.usadas.forEach(c => acumulado.usadas.add(c));
    r.quitadas.forEach(c => acumulado.quitadas.add(c));
    return r.texto;
  }
  if (Array.isArray(valor)) return valor.map(v => validarEnValor(v, permitidas, acumulado));
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, validarEnValor(v, permitidas, acumulado)]));
  }
  return valor;
}

module.exports = { clavesEn, clavesDe, validarCitas, validarEnValor, normalizar };
