const jwt = require('jsonwebtoken');
const { User } = require('../models');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    const user = await User.findByPk(decoded.id, { attributes: { exclude: ['password', 'otp'] } });
    if (!user || !user.is_active) {
      return res.status(401).json({ success: false, message: 'User not found or inactive' });
    }
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

// RBAC-governed panel roles (accounts/sales/business). The per-route role
// lists below predate them: when the central RBAC guard (services/rbac.service
// guard, mounted on /admin) has already approved the request's module for such
// a user, an admin-level route lets them through. Admin-only territory stays
// admin-only because the guard never approves the users/settings/audit modules
// for panel roles.
const RBAC_PANEL_ROLES = ['accounts', 'sales', 'business'];

const authorize = (...roles) => (req, res, next) => {
  if (roles.includes(req.user.role)) return next();
  if (req.rbacApproved && RBAC_PANEL_ROLES.includes(req.user.role) &&
      (roles.includes('admin') || roles.includes('supervisor'))) {
    return next();
  }
  return res.status(403).json({ success: false, message: 'Access denied' });
};

const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, phone: user.phone, role: user.role },
    process.env.JWT_SECRET || 'secret',
    { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
  );
};

const authenticateOptional = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    const user = await User.findByPk(decoded.id, { attributes: { exclude: ['password', 'otp'] } });
    if (user && user.is_active) {
      req.user = user;
    }
    next();
  } catch (error) {
    next();
  }
};

module.exports = { authenticate, authenticateOptional, authorize, generateToken };
