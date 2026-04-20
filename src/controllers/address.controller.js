const { UserAddress } = require('../models');

// Add new address
exports.addAddress = async (req, res) => {
  try {
    const { label, flat_no, building, area, landmark, city, state, pincode, latitude, longitude, is_default } = req.body;
    
    // If setting as default, unset others first
    if (is_default) {
      await UserAddress.update({ is_default: false }, { where: { user_id: req.user.id } });
    }

    const address = await UserAddress.create({
      user_id: req.user.id,
      label: label || 'Home',
      flat_no, building, area, landmark, city, state, pincode,
      latitude, longitude,
      is_default: !!is_default
    });

    res.status(201).json({ success: true, data: address });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Help function for internal use (e.g. from booking controllers)
exports.smartSaveAddress = async (userId, data) => {
  try {
    const { flat_no, building, area, landmark, city, state, pincode, latitude, longitude } = data;
    
    // Check if an almost identical address exists (same lat/lng and same flat)
    const existing = await UserAddress.findOne({
      where: {
        user_id: userId,
        latitude, longitude,
        flat_no: flat_no || null
      }
    });

    if (existing) {
      await existing.update({ building, area, landmark, city, state, pincode });
      return existing;
    }

    return await UserAddress.create({
      user_id: userId,
      label: data.label || 'Home',
      flat_no, building, area, landmark, city, state, pincode,
      latitude, longitude
    });
  } catch (e) {
    console.error('smartSaveAddress error:', e.message);
    return null;
  }
};

// Get all my addresses
exports.getMyAddresses = async (req, res) => {
  try {
    const addresses = await UserAddress.findAll({ 
      where: { user_id: req.user.id },
      order: [['is_default', 'DESC'], ['created_at', 'DESC']]
    });
    res.json({ success: true, data: addresses });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Delete address
exports.deleteAddress = async (req, res) => {
  try {
    const deleted = await UserAddress.destroy({ where: { id: req.params.id, user_id: req.user.id } });
    if (!deleted) return res.status(404).json({ success: false, message: 'Address not found' });
    res.json({ success: true, message: 'Address deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Set default
exports.setDefault = async (req, res) => {
  try {
    await UserAddress.update({ is_default: false }, { where: { user_id: req.user.id } });
    const updated = await UserAddress.update({ is_default: true }, { where: { id: req.params.id, user_id: req.user.id } });
    if (!updated) return res.status(404).json({ success: false, message: 'Address not found' });
    res.json({ success: true, message: 'Default address updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
