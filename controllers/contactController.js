// controllers/contactController.js
const { sendContactMail } = require('../services/emailService');

async function sendContactMessage(req, res) {
  const { name, email, message } = req.body; // ya validados y acotados por zod
  await sendContactMail({ name, email, message });
  res.json({ success: true, msg: 'Mensaje recibido y correo enviado' });
}

module.exports = { sendContactMessage };
