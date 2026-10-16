// test/redaccion.test.js — Piezas de la redacción del artículo (v3.8.0): formato de referencias,
// citas por clave, filtro de fuentes de CrossRef, cifras PRISMA y tablas. Sin red.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');

const F = require('../modules/informes/referencias/formato');
const citas = require('../modules/informes/referencias/citas');
const fuentes = require('../ia/redaccion/fuentes');
const P = require('../modules/informes/prisma');
const T = require('../modules/informes/tablas');
const crossref = require('../infra/crossref');

const ZAWACKI = {
  id_referencia: 1, titulo: 'Systematic review of research on artificial intelligence applications in higher education – where are the educators?',
  autores: F.parseAutores('Zawacki-Richter, Olaf; Marín, Victoria I.; Bond, Melissa; Gouverneur, Franziska'),
  anio: 2019, revista: 'International Journal of Educational Technology in Higher Education', volumen: '16', paginas: '39',
  doi: '10.1186/s41239-019-0171-0', tipo: 'article'
};
const CROMPTON = {
  id_referencia: 2, titulo: 'Artificial intelligence in higher education: The state of the field', autores: F.parseAutores('Crompton H., Burke D.'),
  anio: 2023, revista: 'International Journal of Educational Technology in Higher Education', volumen: '20', numero: '1', paginas: '22',
  doi: '10.1186/s41239-023-00392-8', tipo: 'article'
};

describe('formato de referencias (plantilla de la revisión)', () => {
  test('autores: RIS/API, Scopus, BibTeX y «Nombre Apellido»', () => {
    assert.deepEqual(F.parseAutores('Pérez, Ana; López, M.'), [{ apellido: 'Pérez', nombre: 'Ana' }, { apellido: 'López', nombre: 'M.' }]);
    assert.deepEqual(F.parseAutores('Kurniawan C., Rosmansyah Y.').map(a => a.apellido), ['Kurniawan', 'Rosmansyah']);
    assert.deepEqual(F.parseAutores('Pérez, Ana and López, Marco').map(a => a.apellido), ['Pérez', 'López']);
    assert.deepEqual(F.parseAutores('Ana Pérez; Marco López'), [{ apellido: 'Pérez', nombre: 'Ana' }, { apellido: 'López', nombre: 'Marco' }]);
    assert.equal(F.iniciales('Juan Carlos'), 'J. C.');
    assert.equal(F.iniciales('Jean-Paul'), 'J.-P.');
  });

  test('APA 7 en español e inglés: «y» / «&», número de artículo, DOI como URL y cursivas en revista y volumen', () => {
    const es = F.formatear(ZAWACKI, { estilo: 'apa7', idioma: 'es' });
    assert.equal(es.texto, 'Zawacki-Richter, O., Marín, V. I., Bond, M. y Gouverneur, F. (2019). Systematic review of research on artificial intelligence applications in higher education – where are the educators? International Journal of Educational Technology in Higher Education, 16, Artículo 39. https://doi.org/10.1186/s41239-019-0171-0');
    assert.deepEqual(es.partes.filter(p => p.i).map(p => p.t), ['International Journal of Educational Technology in Higher Education', '16']);
    assert.match(F.formatear(CROMPTON, { estilo: 'apa7', idioma: 'en' }).texto, /^Crompton, H., & Burke, D\. \(2023\)\. .* 20\(1\), Article 22\. https:\/\/doi\.org\//);
    assert.doesNotMatch(es.texto, /\*/, 'sin asteriscos de Markdown');
  });

  test('APA 7 con más de 20 autores: 19, puntos suspensivos y el último', () => {
    const autores = Array.from({ length: 26 }, (_, i) => ({ apellido: `A${i + 1}`, nombre: 'B.' }));
    const t = F.formatear({ titulo: 'T', autores, anio: 2021, revista: 'BMJ', volumen: '372', paginas: 'n71' }, { estilo: 'apa7', idioma: 'es' }).texto;
    assert.match(t, /A19, B\., \. \. \. A26, B\. \(2021\)/);
    assert.doesNotMatch(t, /A20/);
  });

  test('IEEE, Vancouver, ABNT y Chicago', () => {
    assert.equal(F.formatear(CROMPTON, { estilo: 'ieee', idioma: 'en' }).texto,
      'H. Crompton and D. Burke, "Artificial intelligence in higher education: The state of the field," International Journal of Educational Technology in Higher Education, vol. 20, no. 1, Art. no. 22, 2023, doi: 10.1186/s41239-023-00392-8.');
    assert.match(F.formatear(ZAWACKI, { estilo: 'ieee', idioma: 'es' }).texto, /"…|educators\?" International/);
    assert.equal(F.formatear(CROMPTON, { estilo: 'vancouver', idioma: 'es' }).texto,
      'Crompton H, Burke D. Artificial intelligence in higher education: The state of the field. International Journal of Educational Technology in Higher Education. 2023;20(1):22. doi:10.1186/s41239-023-00392-8');
    assert.match(F.formatear(ZAWACKI, { estilo: 'abnt', idioma: 'es' }).texto, /^ZAWACKI-RICHTER, O\. et al\. /);
    assert.match(F.formatear(CROMPTON, { estilo: 'chicago', idioma: 'en' }).texto, /^Crompton, H\., and D\. Burke\. 2023\. "Artificial/);
    assert.equal(F.normalizarEstilo('desconocido'), 'apa7');
  });

  test('citas en el texto según estilo e idioma', () => {
    assert.deepEqual(F.formasDeCita(CROMPTON, { estilo: 'apa7', idioma: 'en' }), { autor: 'Crompton and Burke', parentetica: 'Crompton & Burke, 2023', narrativa: 'Crompton and Burke (2023)' });
    assert.equal(F.formasDeCita(CROMPTON, { estilo: 'apa7', idioma: 'es' }).parentetica, 'Crompton y Burke, 2023');
    assert.equal(F.formasDeCita(ZAWACKI, { estilo: 'apa7', idioma: 'es' }).narrativa, 'Zawacki-Richter et al. (2019)');
    assert.equal(F.formasDeCita(CROMPTON, { estilo: 'abnt', idioma: 'es' }).parentetica, 'CROMPTON; BURKE, 2023');
    assert.equal(F.formasDeCita(CROMPTON, { estilo: 'chicago', idioma: 'en' }).parentetica, 'Crompton and Burke 2023');
    assert.equal(F.esNumerico('ieee'), true);
    assert.equal(F.esNumerico('apa7', 'numerica'), true);
  });

  test('mismo autor y año: 2023a y 2023b por orden de título', () => {
    const a = { id_referencia: 10, titulo: 'B segundo', autores: [{ apellido: 'Lo', nombre: 'C.' }], anio: 2023 };
    const b = { id_referencia: 11, titulo: 'A primero', autores: [{ apellido: 'Lo', nombre: 'C.' }], anio: 2023 };
    const m = F.aniosConLetra([a, b, CROMPTON], { estilo: 'apa7', idioma: 'es' });
    assert.equal(m.get(11), '2023a');
    assert.equal(m.get(10), '2023b');
    assert.equal(m.get(2), '2023');
  });
});

describe('citas por clave', () => {
  const texto = 'Como señala @lo2023, la IA [@crompton2023, @falso2020] cambia todo [@zawacki2019]. Escribe a ana@uni.edu. Otro @inventado2021 dijo algo [@nada2020].';

  test('lee las claves en orden y sin repetir; un correo no es una cita', () => {
    assert.deepEqual(citas.clavesEn(texto), ['lo2023', 'crompton2023', 'falso2020', 'zawacki2019', 'inventado2021', 'nada2020']);
    assert.deepEqual(citas.clavesDe({ a: ['[@x1]', 'y @x2'], b: { c: '[@x1]' } }), ['x1', 'x2']);
  });

  test('quita las claves que no están en el registro y normaliza los grupos', () => {
    const r = citas.validarCitas(texto, ['lo2023', 'crompton2023', 'zawacki2019']);
    assert.equal(r.texto, 'Como señala @lo2023, la IA [@crompton2023] cambia todo [@zawacki2019]. Escribe a ana@uni.edu. Otro dijo algo.');
    assert.deepEqual(r.usadas, ['lo2023', 'crompton2023', 'zawacki2019']);
    assert.deepEqual(r.quitadas.sort(), ['falso2020', 'inventado2021', 'nada2020']);
  });
});

describe('fuentes de CrossRef con filtro de pertinencia', () => {
  const CADENA = 'TITLE-ABS-KEY(("generative artificial intelligence" OR "ChatGPT" OR "large language model*") AND ("assessment" OR evaluation OR feedback) AND ("higher education" OR university))';

  test('la cadena booleana se convierte en grupos de conceptos (sin perder los AND)', () => {
    assert.deepEqual(fuentes.conceptosDeCadena(CADENA), [
      ['generative artificial intelligence', 'ChatGPT', 'large language model*'], ['assessment', 'evaluation', 'feedback'], ['higher education', 'university']
    ]);
    assert.deepEqual(fuentes.conceptosDeCadena('"virtual reality" AND (learning OR education OR training)'), [['virtual reality'], ['learning', 'education', 'training']]);
  });

  test('una fuente que solo comparte una palabra suelta queda fuera; las pertinentes se ordenan', async () => {
    const item = (doi, titulo, resumen) => ({ DOI: doi, title: [titulo], abstract: resumen, author: [{ family: 'X', given: 'Y' }], issued: { 'date-parts': [[2024]] } });
    const original = crossref.searchBilingual;
    crossref.searchBilingual = async () => ({ items: [
      item('10.1/forense', 'Evaluación de restos óseos en arqueología forense', 'Métodos de evaluación en arqueología.'),
      item('10.1/llm', 'Large language models for automated feedback in university courses', 'We study ChatGPT feedback in higher education.'),
      item('10.1/medio', 'ChatGPT in assessment', 'Generative AI and assessment practices.'),
      item('10.1/incluido', 'ChatGPT feedback at university', 'Large language model feedback in higher education.')
    ] });
    try {
      const r = await fuentes.buscarFuentes({ consultas: ['chatgpt assessment'], grupos: fuentes.conceptosDeCadena(CADENA), perfil: 'IA generativa en evaluación', excluirDois: ['10.1/INCLUIDO'] });
      assert.deepEqual(r.map(x => x.item.DOI), ['10.1/llm', '10.1/medio']);
      assert.equal(r[0].relevancia, 1);
      assert.deepEqual(r[1].coincidencias, [0, 1]);
    } finally {
      crossref.searchBilingual = original;
    }
  });
});

describe('cifras PRISMA, calidad y panorama', () => {
  const estudios = [
    { id_estudios: 1, estado: 'Aceptado', fuente_bibliografica: 'Scopus' },
    { id_estudios: 2, estado: 'Aceptado', fuente_bibliografica: 'Scopus' },
    { id_estudios: 3, estado: 'Rechazado', id_criterio: null, fuente_bibliografica: 'IEEE Xplore' },
    { id_estudios: 4, estado: 'Rechazado', id_criterio: 21, fuente_bibliografica: 'IEEE Xplore' },
    { id_estudios: 5, estado: 'Duplicado', fuente_bibliografica: 'Scopus' },
    { id_estudios: 6, estado: 'Sin clasificar', fuente_bibliografica: '' }
  ];
  const criterios = [{ id_criterios: 20, tipo: 'inclusion', descripcion: 'Educación superior' }, { id_criterios: 21, tipo: 'exclusion', descripcion: 'Sin datos empíricos' }];

  test('mismas cuentas que el diagrama de la pantalla, con los motivos codificados', () => {
    const p = P.contarPrisma(estudios, criterios);
    assert.equal(p.identificados, 6);
    assert.deepEqual(p.por_fuente, [{ fuente: 'Scopus', n: 3 }, { fuente: 'IEEE Xplore', n: 2 }, { fuente: 'Sin especificar', n: 1 }]);
    assert.equal(p.duplicados, 1);
    assert.equal(p.cribados, 5);
    assert.equal(p.excluidos_cribado, 1);
    assert.equal(p.evaluados_texto_completo, 3);
    assert.deepEqual(p.motivos_exclusion, [{ codigo: 'CE1', motivo: 'Sin datos empíricos', n: 1 }]);
    assert.equal(p.incluidos, 2);
    assert.equal(p.pendientes, 1);
    assert.deepEqual(P.codigosCriterios(criterios).map(c => c.codigo), ['CI1', 'CE1']);
  });

  test('calidad: distribución por pregunta, umbral y quién lo supera', () => {
    const q = P.resumenCalidad({
      incluidos: [{ id_estudios: 1 }, { id_estudios: 2 }],
      preguntas: [{ id_pregunta: 7, descripcion: '¿Objetivos claros?' }, { id_pregunta: 8, descripcion: '¿Muestra adecuada?' }],
      respuestas: [{ id_respuesta: 1, descripcion: 'Sí', peso: 1 }, { id_respuesta: 2, descripcion: 'No', peso: 0 }],
      evaluaciones: [{ id_estudios: 1, id_pregunta: 7, id_respuesta: 1, peso: 1 }, { id_estudios: 1, id_pregunta: 8, id_respuesta: 1, peso: 1 },
        { id_estudios: 2, id_pregunta: 7, id_respuesta: 1, peso: 1 }, { id_estudios: 2, id_pregunta: 8, id_respuesta: 2, peso: 0 }],
      umbral: { puntuacion_limite: 2 }
    });
    assert.equal(q.maxima, 2);
    assert.equal(q.superan, 1);
    assert.deepEqual(q.preguntas[1].distribucion.map(d => d.n), [1, 1]);
    assert.equal(q.preguntas[0].codigo, 'QA1');
  });

  test('panorama por año, fuente y tipo de publicación', () => {
    const pan = P.panorama([{ anio: 2022, fuente_bibliografica: 'Scopus', document_type: 'Article' }, { anio: 2024, fuente_bibliografica: 'Scopus', document_type: 'Conference Paper' }]);
    assert.deepEqual([pan.desde, pan.hasta], [2022, 2024]);
    assert.deepEqual(pan.por_tipo.map(t => t.valor).sort(), ['conferencia', 'revista']);
    assert.equal(pan.por_fuente[0].pct, 100);
  });
});

describe('tablas del artículo', () => {
  test('escapan el HTML y dejan las citas como [@clave]', () => {
    const html = T.categorias([{ nombre: 'Retroalimentación <b>', claves: ['lo2023', 'burke2023'] }], 4, 'es');
    assert.match(html, /Retroalimentación &lt;b&gt;/);
    assert.match(html, /\[@lo2023; @burke2023\]/);
    assert.match(html, /2 \(50 %\)/);
    assert.match(T.criterios([{ codigo: 'CE1', tipo: 'exclusion', descripcion: 'Sin datos' }], 'en'), /<th>Code<\/th>.*Exclusion/);
    assert.equal(T.vacios([], 'es'), '');
  });
});
