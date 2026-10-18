// test/academicas.test.js — IEEE Xplore y Springer Nature: parámetros de la petición y
// conversión de la respuesta al formato de fn_importar_estudios. Sin red (http simulado).
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');
const env = require('../config/env');
const academicas = require('../infra/academicas');

const original = { get: academicas._http.get, ieee: env.IEEE_API_KEY, springer: env.SPRINGER_API_KEY };
let peticiones;
let responder;
beforeEach(() => {
  peticiones = [];
  academicas._http.get = async (url, cfg) => { peticiones.push({ url, params: { ...cfg.params } }); return { data: await responder(url, cfg.params) }; };
  env.IEEE_API_KEY = 'clave-ieee';
  env.SPRINGER_API_KEY = 'clave-springer';
});
afterEach(() => {
  academicas._http.get = original.get;
  env.IEEE_API_KEY = original.ieee;
  env.SPRINGER_API_KEY = original.springer;
});

describe('IEEE Xplore', () => {
  test('pide la página con start_record, años y clave; convierte autores, resumen y acceso abierto', async () => {
    responder = () => ({
      total_records: 321,
      articles: [{
        article_number: '9000001', doi: '10.1109/X.2024.1', title: 'Deep <i>malware</i> detection',
        abstract: 'Un <b>resumen</b>.', publication_title: 'IEEE Access', publication_year: 2024, volume: '12',
        start_page: '10', end_page: '20', issn: '2169-3536', html_url: 'https://ieeexplore.ieee.org/document/9000001',
        pdf_url: 'https://ieeexplore.ieee.org/stamp/9000001', access_type: 'OPEN_ACCESS', content_type: 'Journals',
        publisher: 'IEEE', citing_paper_count: 7,
        authors: { authors: [{ full_name: 'Luis Ortega', author_order: 2 }, { full_name: 'Ana María Pérez', author_order: 1 }] },
        index_terms: { author_terms: { terms: ['malware', 'deep learning'] }, ieee_terms: { terms: ['malware'] } }
      }, { title: 'Sin acceso', access_type: 'LOCKED', pdf_url: 'https://x/pdf', publication_year: '2023' }]
    });
    const r = await academicas.FUENTES.ieee({ cadena: '"malware" AND "deep learning"', anioDesde: 2020, anioHasta: 2024, pagina: 3, porPagina: 50 });
    const { url, params } = peticiones[0];
    assert.equal(url, 'https://ieeexploreapi.ieee.org/api/v1/search/articles');
    assert.deepEqual(params, { apikey: 'clave-ieee', format: 'json', querytext: '"malware" AND "deep learning"', max_records: 50, start_record: 101, start_year: 2020, end_year: 2024 });
    assert.equal(r.total, 321);
    const [a, b] = r.items;
    assert.equal(a.titulo, 'Deep malware detection');
    assert.equal(a.resumen, 'Un resumen.');
    assert.equal(a.autores, 'Pérez, Ana María; Ortega, Luis');
    assert.equal(a.anio, 2024);
    assert.equal(a.paginas, '10-20');
    assert.equal(a.doi, '10.1109/X.2024.1');
    assert.equal(a.keywords, 'malware, deep learning');
    assert.equal(a.acceso_abierto, true);
    assert.equal(a.url_pdf_externo, 'https://ieeexplore.ieee.org/stamp/9000001');
    assert.equal(b.acceso_abierto, false);
    assert.equal(b.url_pdf_externo, null, 'solo se guarda el PDF si es de acceso abierto');
    assert.equal(b.anio, 2023);
  });

  test('sin IEEE_API_KEY → 503 con el nombre de la variable', async () => {
    env.IEEE_API_KEY = '';
    await assert.rejects(academicas.FUENTES.ieee({ cadena: 'x', pagina: 1, porPagina: 10 }), e => e.status === 503 && /IEEE_API_KEY/.test(e.message));
    assert.equal(peticiones.length, 0);
  });
});

describe('Springer Nature', () => {
  const registro = (i, extra = {}) => ({
    identifier: `doi:10.1007/s${i}`, doi: `10.1007/s${i}`, title: `Artículo ${i}`,
    creators: [{ creator: 'Pérez, Ana' }, { creator: 'Ortega, Luis' }], publicationName: 'Journal X',
    publicationDate: '2022-05-01', volume: '3', startingPage: '1', endingPage: '9', issn: '1234-5678',
    openaccess: 'true', contentType: 'Article', language: 'en', publisher: 'Springer',
    url: [{ format: '', value: `http://dx.doi.org/10.1007/s${i}` }, { format: 'pdf', value: `https://link.springer.com/content/pdf/${i}.pdf` }],
    abstract: { h1: 'Abstract', p: ['Primera parte.', 'Segunda parte.'] }, keyword: ['malware'],
    ...extra
  });

  test('completa la página con lotes de 25 y filtra por fechas en la consulta', async () => {
    responder = (url, p) => ({ result: [{ total: '60' }], records: Array.from({ length: p.p }, (_, k) => registro(p.s + k)) });
    const r = await academicas.FUENTES.springer({ cadena: 'malware AND "deep learning"', anioDesde: 2020, anioHasta: 2024, pagina: 2, porPagina: 30 });
    assert.equal(peticiones.length, 2);
    assert.equal(peticiones[0].url, 'https://api.springernature.com/meta/v2/json');
    assert.deepEqual(peticiones.map(x => [x.params.s, x.params.p]), [[31, 25], [56, 5]]);
    assert.equal(peticiones[0].params.q, '(malware AND "deep learning") AND datefrom:2020-01-01 AND dateto:2024-12-31');
    assert.equal(peticiones[0].params.api_key, 'clave-springer');
    assert.equal(r.total, 60);
    assert.equal(r.items.length, 30);
    const a = r.items[0];
    assert.equal(a.titulo, 'Artículo 31');
    assert.equal(a.autores, 'Pérez, Ana; Ortega, Luis');
    assert.equal(a.resumen, 'Primera parte. Segunda parte.');
    assert.equal(a.anio, 2022);
    assert.equal(a.paginas, '1-9');
    assert.equal(a.url, 'http://dx.doi.org/10.1007/s31');
    assert.equal(a.url_pdf_externo, 'https://link.springer.com/content/pdf/31.pdf');
    assert.equal(a.acceso_abierto, true);
  });

  test('si el plan no admite el filtro de fechas, repite sin él y filtra los años aquí', async () => {
    responder = (url, p) => {
      if (/datefrom/.test(p.q)) { const e = new Error('Premium only'); e.response = { status: 403 }; throw e; }
      return { result: [{ total: '2' }], records: [registro(1, { publicationDate: '2018-01-01' }), registro(2, { abstract: 'Texto <b>plano</b>' })] };
    };
    const r = await academicas.FUENTES.springer({ cadena: 'malware', anioDesde: 2020, pagina: 1, porPagina: 10 });
    assert.equal(peticiones.length, 2);
    assert.equal(peticiones[1].params.q, 'malware');
    assert.deepEqual(r.items.map(i => i.titulo), ['Artículo 2']);
    assert.equal(r.items[0].resumen, 'Texto plano');
  });

  test('sin SPRINGER_API_KEY → 503', async () => {
    env.SPRINGER_API_KEY = '';
    await assert.rejects(academicas.FUENTES.springer({ cadena: 'x', pagina: 1, porPagina: 10 }), e => e.status === 503 && /SPRINGER_API_KEY/.test(e.message));
  });
});
