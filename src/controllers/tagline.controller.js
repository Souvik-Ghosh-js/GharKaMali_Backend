const { Tagline } = require('../models');

// Admin: Get all taglines
exports.getAdminTaglines = async (req, res) => {
  try {
    const list = await Tagline.findAll({
      order: [['display_order', 'ASC'], ['created_at', 'DESC']]
    });
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Admin: Create tagline
exports.createTagline = async (req, res) => {
  try {
    const { text, image_url, display_order, is_active } = req.body;
    if (!text) return res.status(400).json({ success: false, message: 'Text is required' });
    
    const item = await Tagline.create({ text, image_url, display_order, is_active: is_active !== false });
    res.status(201).json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Admin: Update tagline
exports.updateTagline = async (req, res) => {
  try {
    const item = await Tagline.findByPk(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Tagline not found' });
    
    await item.update(req.body);
    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Admin: Delete tagline
exports.deleteTagline = async (req, res) => {
  try {
    const item = await Tagline.findByPk(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Tagline not found' });
    
    await item.destroy();
    res.json({ success: true, message: 'Tagline deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Public: Get active taglines
exports.getActiveTaglines = async (req, res) => {
  try {
    const list = await Tagline.findAll({
      where: { is_active: true },
      order: [['display_order', 'ASC']]
    });
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
