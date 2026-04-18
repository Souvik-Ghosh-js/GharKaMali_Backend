const { Notification } = require('../models');

let io; // Will be initialized from index.js

const init = (socketIo) => {
  io = socketIo;
};

/**
 * Send notification to a specific user
 */
const notifyUser = async (userId, payload) => {
  const { title, body, type = 'info', data = {} } = payload;
  
  // Persist
  const notification = await Notification.create({
    user_id: userId,
    target_role: 'user',
    title,
    body,
    type,
    data
  });

  // Real-time
  if (io) {
    io.to(`user-${userId}`).emit('notification', notification);
  }
  
  return notification;
};

/**
 * Send notification to all admins
 */
const notifyAdmins = async (payload) => {
  const { title, body, type = 'info', data = {} } = payload;
  
  // Persist for history (setting user_id to null or a specific admin is debatable, 
  // but for broadcast we use target_role='admin')
  const notification = await Notification.create({
    target_role: 'admin',
    title,
    body,
    type,
    data
  });

  // Real-time
  if (io) {
    io.to('admins').emit('notification', notification);
  }
  
  return notification;
};

/**
 * Send notification to a specific geofence
 */
const notifyGeofence = async (geofenceId, payload) => {
  const { title, body, type = 'info', data = {}, targetRole = 'customer' } = payload;
  
  // Persist
  const notification = await Notification.create({
    geofence_id: geofenceId,
    target_role: targetRole,
    title,
    body,
    type,
    data
  });

  // Real-time
  if (io) {
    io.to(`geofence-${geofenceId}`).emit('notification', notification);
  }
  
  return notification;
};

/**
 * Send broadcast notification to all users
 */
const notifyAll = async (payload) => {
  const { title, body, type = 'info', data = {} } = payload;
  
  // Persist
  const notification = await Notification.create({
    target_role: 'all',
    title,
    body,
    type,
    data
  });

  // Real-time
  if (io) {
    io.emit('notification', notification);
  }
  
  return notification;
};

module.exports = {
  init,
  notifyUser,
  notifyAdmins,
  notifyGeofence,
  notifyAll
};
