// core/contexto.js
// Lo único que los servicios necesitan de la petición: quién es el usuario y su token
// (para consultar la base como él). Así los servicios no dependen de Express.
const contexto = req => ({ token: req.token, user: req.user });

module.exports = { contexto };
