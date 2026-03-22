/**
 * push.service.js
 * Firebase Cloud Messaging push notifications.
 *
 * Setup:
 *  1. Firebase Console → Project Settings → Service Accounts → Generate New Private Key
 *  2. Save as: backend/firebase-service-account.json  (add to .gitignore)
 *  3. OR set FIREBASE_SERVICE_ACCOUNT env var (JSON string) on Lightsail
 *
 *  Flutter setup (both apps):
 *  - Add google-services.json (Android) / GoogleService-Info.plist (iOS) from Firebase
 *  - Initialize firebase_messaging in main.dart
 */

let admin = null;
let initialized = false;

const initFirebase = () => {
  if (initialized) return true;
  try {
    admin = require('firebase-admin');
    let serviceAccount;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else {
      const path = require('path');
      serviceAccount = require(path.join(__dirname, '../../firebase-service-account.json'));
    }
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    initialized = true;
    console.log('✅ Firebase Admin initialized');
    return true;
  } catch (err) {
    console.warn('⚠️  Firebase not initialized (push notifications disabled):', err.message);
    return false;
  }
};

/**
 * Send push to a single FCM token
 */
const sendPush = async (fcmToken, title, body, data = {}) => {
  if (!fcmToken) return { success: false, reason: 'no_token' };
  if (!initFirebase()) return { success: false, reason: 'firebase_not_initialized' };
  try {
    const message = {
      token: fcmToken,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: { priority: 'high', notification: { sound: 'default', clickAction: 'FLUTTER_NOTIFICATION_CLICK' } },
      apns:    { payload: { aps: { sound: 'default', badge: 1 } } },
    };
    const result = await admin.messaging().send(message);
    return { success: true, messageId: result };
  } catch (err) {
    console.error('FCM send error:', err.message);
    return { success: false, error: err.message };
  }
};

/**
 * Send to multiple tokens (batched, max 500 per call)
 */
const sendMulticast = async (fcmTokens, title, body, data = {}) => {
  const tokens = (fcmTokens || []).filter(Boolean);
  if (!tokens.length) return { success: false, reason: 'no_tokens' };
  if (!initFirebase()) return { success: false, reason: 'firebase_not_initialized' };
  try {
    const results = [];
    for (let i = 0; i < tokens.length; i += 500) {
      const batch = tokens.slice(i, i + 500);
      const message = {
        tokens: batch,
        notification: { title, body },
        data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
        android: { priority: 'high' },
      };
      const res = await admin.messaging().sendEachForMulticast(message);
      results.push({ successCount: res.successCount, failureCount: res.failureCount });
    }
    return { success: true, results };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

// ── Notification templates ────────────────────────────────────────────────────
const notify = {
  bookingAssigned: (fcmToken, bookingNumber, gardenerName) =>
    sendPush(fcmToken, '🌿 Gardener Assigned!',
      `${gardenerName} has been assigned to your booking ${bookingNumber}.`,
      { type: 'booking_assigned', booking_number: bookingNumber }),

  gardenerEnRoute: (fcmToken, gardenerName, bookingNumber) =>
    sendPush(fcmToken, '🚶 Gardener On The Way!',
      `${gardenerName} is heading to your location for ${bookingNumber}.`,
      { type: 'en_route', booking_number: bookingNumber }),

  gardenerArrived: (fcmToken, otp, bookingNumber) =>
    sendPush(fcmToken, '✅ Gardener Arrived!',
      `Your gardener is here! Share OTP: ${otp} to start.`,
      { type: 'arrived', booking_number: bookingNumber, otp }),

  visitCompleted: (fcmToken, bookingNumber, amount) =>
    sendPush(fcmToken, '🎉 Visit Completed!',
      `Your garden service is done. Total: ₹${amount}. Rate your experience!`,
      { type: 'completed', booking_number: bookingNumber }),

  newJobAssigned: (fcmToken, bookingNumber, address, date) =>
    sendPush(fcmToken, '📋 New Job Assigned',
      `You have a new job on ${date} at ${address}.`,
      { type: 'new_job', booking_number: bookingNumber }),

  complaintResolved: (fcmToken, complaintId) =>
    sendPush(fcmToken, '✅ Complaint Resolved',
      `Your complaint #${complaintId} has been resolved by our team.`,
      { type: 'complaint_resolved', complaint_id: String(complaintId) }),

  slaBreachAlert: (fcmToken, bookingNumber, delayMins) =>
    sendPush(fcmToken, '⚠️ SLA Breach Detected',
      `Booking ${bookingNumber} is ${delayMins} minutes late. Please investigate.`,
      { type: 'sla_breach', booking_number: bookingNumber }),
};

module.exports = { sendPush, sendMulticast, notify };
