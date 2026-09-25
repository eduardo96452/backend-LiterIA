// utils/safeUrl.js
// Protección contra SSRF: solo https, sin credenciales, sin hosts internos/privados.
const dns = require('dns').promises;
const net = require('net');
const { HttpError } = require('./httpError');

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}
function inCidr4(ip, cidr) {
  const [base, bits] = cidr.split('/');
  const mask = bits === '0' ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}
const PRIVATE_V4 = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
  '172.16.0.0/12', '192.0.0.0/24', '192.168.0.0/16', '198.18.0.0/15', '224.0.0.0/3'
];

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) return PRIVATE_V4.some(c => inCidr4(ip, c));
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === '::' || low === '::1') return true;
    if (low.startsWith('fc') || low.startsWith('fd')) return true;        // fc00::/7 ULA
    if (/^fe[89ab]/.test(low)) return true;                                // fe80::/10 link-local
    const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);             // IPv4-mapped
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return true; // no es IP válida → tratar como inseguro
}

async function assertSafeUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new HttpError(400, 'URL inválida.'); }
  if (url.protocol !== 'https:') throw new HttpError(400, 'Solo se permiten URLs https.');
  if (url.username || url.password) throw new HttpError(400, 'La URL no puede contener credenciales.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new HttpError(400, 'Host no permitido.');
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new HttpError(400, 'Host no permitido.');
    return url;
  }
  let records;
  try { records = await dns.lookup(host, { all: true }); }
  catch { throw new HttpError(400, 'No se pudo resolver el host.'); }
  if (!records.length || records.some(r => isPrivateIp(r.address))) {
    throw new HttpError(400, 'Host no permitido.');
  }
  return url;
}

module.exports = { assertSafeUrl, isPrivateIp };
