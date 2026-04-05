const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { User, GardenerProfile, Geofence, ServiceZone } = require('../models');
const { generateToken } = require('../middleware/auth');
const { generateOTP, sendOTP, sendWhatsApp, templates } = require('../services/otp.service');

// Send OTP
exports.sendOtp = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || !/^[6-9]\d{9}$/.test(phone)) {
      return res.status(400).json({ success: false, message: 'Invalid phone number' });
    }
    const otp = process.env.USE_STATIC_OTP === 'true' ? (process.env.STATIC_OTP || '123456') : generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    await User.update({ otp, otp_expires_at: expiresAt }, { where: { phone } });
    // If user doesn't exist, we'll create on verify
    await sendOTP(phone, otp);

    res.json({ success: true, message: 'OTP sent successfully', ...(process.env.USE_STATIC_OTP === 'true' ? { otp } : {}) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Verify OTP and login/register customer
exports.verifyOtp = async (req, res) => {
  try {
    const { phone, otp, name, fcm_token } = req.body;
    const staticOtp = process.env.STATIC_OTP || '123456';

    let user = await User.findOne({ where: { phone } });

    if (process.env.USE_STATIC_OTP === 'true') {
      if (otp !== staticOtp) return res.status(400).json({ success: false, message: 'Invalid OTP' });
    } else {
      if (!user || !user.otp || user.otp !== otp) return res.status(400).json({ success: false, message: 'Invalid OTP' });
      if (new Date() > user.otp_expires_at) return res.status(400).json({ success: false, message: 'OTP expired' });
    }

    if (!user) {
      // New customer registration
      const referralCode = `GKM${phone.slice(-6)}`;
      user = await User.create({ name: name || 'Customer', phone, role: 'customer', is_active: true, is_approved: true, referral_code: referralCode });
    }

    await user.update({ otp: null, otp_expires_at: null, last_login: new Date(), ...(fcm_token ? { fcm_token } : {}) });

    const token = generateToken(user);
    const userData = user.toJSON();
    delete userData.password;
    delete userData.otp;

    res.json({ success: true, message: 'Login successful', data: { token, user: userData } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Admin login with password
exports.adminLogin = async (req, res) => {
  try {
    const { phone, password } = req.body;
    const user = await User.findOne({ where: { phone, role: { [Op.in]: ['admin', 'supervisor'] } } });
    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    if (!user.is_active) return res.status(401).json({ success: false, message: 'Account is deactivated' });

    await user.update({ last_login: new Date() });
    const token = generateToken(user);
    const userData = user.toJSON();
    delete userData.password;

    res.json({ success: true, message: 'Login successful', data: { token, user: userData } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Gardener register
exports.gardenerRegister = async (req, res) => {
  try {
    const { name, phone, email, experience_years, bio, service_zone_ids } = req.body;

    const existing = await User.findOne({ where: { phone } });
    if (existing) return res.status(400).json({ success: false, message: 'Phone already registered' });

    const referralCode = `GKM${phone.slice(-6)}`;
    const user = await User.create({ name, phone, email, role: 'gardener', is_active: true, is_approved: false, referral_code: referralCode });

    const profile = await GardenerProfile.create({ user_id: user.id, experience_years: experience_years || 0, bio: bio || '' });

    if (req.files) {
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      if (req.files.profile_image) await user.update({ profile_image: `${baseUrl}/uploads/profiles/${req.files.profile_image[0].filename}` });
      if (req.files.id_proof) await profile.update({ id_proof_image: `${baseUrl}/uploads/id-proofs/${req.files.id_proof[0].filename}` });
    }

    res.status(201).json({ success: true, message: 'Registration submitted. Awaiting admin approval.', data: { user_id: user.id } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get profile
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ['password', 'otp', 'otp_expires_at'] },
      include: [
        ...(req.user.role === 'gardener' ? [{ model: GardenerProfile, as: 'gardenerProfile' }] : []),
        { model: Geofence, as: 'geofence' },
        { model: ServiceZone, as: 'serviceZone' }
      ]
    });
    res.json({ success: true, data: user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Update profile
exports.updateProfile = async (req, res) => {
  try {
    const { name, email, address, city, state, pincode, latitude, longitude } = req.body;
    const updates = { name, email, address, city, state, pincode };

    if (latitude != null && longitude != null) {
      updates.latitude = parseFloat(latitude);
      updates.longitude = parseFloat(longitude);
      
      const { resolveGeofence } = require('../utils/geo');
      const gf = await resolveGeofence(updates.latitude, updates.longitude);
      if (gf) {
        updates.geofence_id = gf.id;
        // Optionally update service_zone_id if needed, but geofence_id is prioritized for shop
      }
    }

    if (req.file) {
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      updates.profile_image = `${baseUrl}/uploads/profiles/${req.file.filename}`;
    }

    await User.update(updates, { where: { id: req.user.id } });
    const user = await User.findByPk(req.user.id, { 
      attributes: { exclude: ['password', 'otp'] },
      include: [
        { model: Geofence, as: 'geofence' },
        { model: ServiceZone, as: 'serviceZone' }
      ]
    });
    res.json({ success: true, message: 'Profile updated', data: user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Gardener OTP login (same as customer)
exports.gardenerLogin = async (req, res) => {
  try {
    const { phone, otp, fcm_token } = req.body;
    const staticOtp = process.env.STATIC_OTP || '123456';

    const user = await User.findOne({ where: { phone, role: 'gardener' } });
    if (!user) return res.status(404).json({ success: false, message: 'Gardener not found' });
    if (!user.is_approved) return res.status(403).json({ success: false, message: 'Account not yet approved' });

    if (process.env.USE_STATIC_OTP === 'true') {
      if (otp !== staticOtp) return res.status(400).json({ success: false, message: 'Invalid OTP' });
    } else {
      if (user.otp !== otp) return res.status(400).json({ success: false, message: 'Invalid OTP' });
      if (new Date() > user.otp_expires_at) return res.status(400).json({ success: false, message: 'OTP expired' });
    }

    await user.update({ otp: null, last_login: new Date(), ...(fcm_token ? { fcm_token } : {}) });
    const profile = await GardenerProfile.findOne({ where: { user_id: user.id } });
    const token = generateToken(user);
    const userData = user.toJSON();
    delete userData.password; delete userData.otp;

    res.json({ success: true, data: { token, user: userData, profile } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
