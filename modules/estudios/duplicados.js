// modules/estudios/duplicados.js
// ¿Este estudio ya está en la revisión? Se comprueba ANTES de pedir la sugerencia a la IA: la IA
// solo lee título y resumen contra los criterios, así que un duplicado le parecía un estudio más y
// lo incluía o excluía. Mismos criterios que fn_detectar_duplicados de la base (DOI, identificador
// externo, título idéntico o casi idéntico con año compatible), pero sin escribir en ninguna tabla,
// para que funcione igual para el propietario y para los revisores.
const { normalizarTitulo, claveDoi } = require('./campos');

/** Umbral de parecido de títulos (el mismo que usa fn_detectar_duplicados por defecto). */
const UMBRAL = 0.85;

/** Trigramas como los de pg_trgm: cada palabra con dos espacios delante y uno detrás. */
function trigramas(textoNormalizado) {
  const set = new Set();
  for (const palabra of textoNormalizado.split(' ').filter(Boolean)) {
    const p = `  ${palabra} `;
    for (let i = 0; i + 3 <= p.length; i++) set.add(p.slice(i, i + 3));
  }
  return set;
}

/** Parecido entre dos títulos ya normalizados, de 0 a 1 (como similarity() de pg_trgm). */
function similitud(a, b) {
  if (!a || !b) return 0;
  const ta = trigramas(a), tb = trigramas(b);
  let comunes = 0;
  for (const t of ta) if (tb.has(t)) comunes++;
  const union = ta.size + tb.size - comunes;
  return union ? comunes / union : 0;
}

const MOTIVOS = { doi: 1, id_externo: 2, titulo_exacto: 3, titulo_similar: 4 };

/**
 * Busca, entre los estudios anteriores de la revisión (id menor, que no estén ya marcados como
 * duplicado), el que más probablemente es el mismo trabajo. El de id mayor es la copia: así, de un
 * par, solo uno recibe la sugerencia «Duplicado».
 * @returns {{ original: object, motivo: string, similitud: number } | null}
 */
function buscarDuplicado(estudio, todos, umbral = UMBRAL) {
  const titulo = normalizarTitulo(estudio.titulo);
  const doi = claveDoi(estudio.doi);
  const externo = String(estudio.id_externo ?? '').trim().toLowerCase() || null;
  let mejor = null;

  for (const o of todos) {
    if (o.id_estudios >= estudio.id_estudios || o.estado === 'Duplicado') continue;
    let motivo = null, sim = 1;
    if (doi && claveDoi(o.doi) === doi) motivo = 'doi';
    else if (externo && String(o.id_externo ?? '').trim().toLowerCase() === externo) motivo = 'id_externo';
    else {
      const otro = normalizarTitulo(o.titulo);
      if (titulo && otro === titulo) motivo = 'titulo_exacto';
      else {
        const anioCompatible = !estudio.anio || !o.anio || Math.abs(Number(estudio.anio) - Number(o.anio)) <= 1;
        sim = anioCompatible ? similitud(titulo, otro) : 0;
        if (sim >= umbral) motivo = 'titulo_similar';
      }
    }
    if (!motivo) continue;
    const candidato = { original: o, motivo, similitud: Math.round(sim * 1000) / 1000 };
    if (!mejor || MOTIVOS[motivo] < MOTIVOS[mejor.motivo]
        || (motivo === mejor.motivo && candidato.similitud > mejor.similitud)) mejor = candidato;
  }
  return mejor;
}

/** La sugerencia que se guarda y se muestra en el panel cuando el estudio es una copia. */
function sugerenciaDeDuplicado({ original, motivo, similitud: sim }) {
  const porque = {
    doi: 'tienen el mismo DOI',
    id_externo: 'tienen el mismo identificador en la base de origen',
    titulo_exacto: 'tienen el mismo título',
    titulo_similar: `sus títulos coinciden en un ${Math.round(sim * 100)} %`
  }[motivo];
  const anio = original.anio ? `, ${original.anio}` : '';
  return {
    sugerencia: 'Duplicado',
    id_criterio: null,
    confianza: motivo === 'titulo_similar' ? sim : 1,
    justificacion: `Parece el mismo trabajo que «${String(original.titulo).slice(0, 300)}» (n.º ${original.id_estudios}${anio}): ${porque}.`,
    id_original: original.id_estudios
  };
}

module.exports = { buscarDuplicado, sugerenciaDeDuplicado, similitud, trigramas, UMBRAL };
