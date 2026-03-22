require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
// Disable CSP for Swagger UI (helmet blocks its inline scripts by default)
app.use('/api-docs', (req, res, next) => {
  res.setHeader('Content-Security-Policy', '');
  next();
});
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── RATE LIMITING ─────────────────────────────────────────────────────────────
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

const otpLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, message: { success: false, message: 'Too many OTP requests' } });
app.use('/api/auth/send-otp', otpLimiter);

// ── STATIC FILES ──────────────────────────────────────────────────────────────
const uploadPath = process.env.UPLOAD_PATH || path.join(__dirname, '../uploads');
app.use('/uploads', express.static(uploadPath));

// ── SWAGGER ───────────────────────────────────────────────────────────────────
const swaggerDoc = require('./swagger.json');
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc, { explorer: true }));

// ── ROUTES ────────────────────────────────────────────────────────────────────
app.use('/api', require('./routes'));

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date(), version: '1.0.0' }));

// ── ERROR HANDLER ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ success: false, message: err.message || 'Internal server error' });
});

app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }));

// ── START ─────────────────────────────────────────────────────────────────────
const { sequelize } = require('./models');
const http = require('http');
const { Server } = require('socket.io');
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Socket.io for real-time tracking
io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('join-booking', (bookingId) => socket.join(`booking-${bookingId}`));

  socket.on('gardener-location', (data) => {
    const { booking_id, latitude, longitude } = data;
    io.to(`booking-${booking_id}`).emit('location-update', { latitude, longitude, timestamp: new Date() });
  });

  socket.on('disconnect', () => console.log('Socket disconnected:', socket.id));
});

sequelize.authenticate()
  .then(() => {
    console.log('✅ Database connected');
    return sequelize.sync({ alter: process.env.NODE_ENV === 'development' });
  })
  .then(() => {
    require('./services/cron.service');
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Ghar Ka Mali API running on port ${PORT}`);
      console.log(`📚 Swagger docs: http://localhost:${PORT}/api-docs`);
    });
  })
  .catch(err => {
    console.error('Failed to start:', err);
    process.exit(1);
  });

module.exports = app;
