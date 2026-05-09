const { sendCareerApplication } = require('../services/email.service');
const { sequelize } = require('../models');

exports.apply = async (req, res) => {
  try {
    const { name, phone, whatsapp, email, experience, cities, bio } = req.body;

    if (!name || !phone || !experience || !cities) {
      return res.status(400).json({ success: false, message: 'Name, phone, experience, and cities are required.' });
    }

    // Persist to DB
    await sequelize.query(
      `INSERT INTO career_applications (name, phone, whatsapp, email, experience, cities, bio, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      { replacements: [name, phone, whatsapp || null, email || null, experience, cities, bio || null] }
    );

    // Fire-and-forget email — don't block response on SMTP
    sendCareerApplication({ name, phone, whatsapp, email, experience, cities, bio }).catch(err =>
      console.error('[careers] email send failed:', err.message)
    );

    res.status(201).json({ success: true, message: 'Application received! We will contact you soon.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
