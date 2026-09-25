// utils/httpError.js
class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
    this.expose = true; // los mensajes de HttpError los redacta el servidor y son seguros de exponer
  }
}
module.exports = { HttpError };
