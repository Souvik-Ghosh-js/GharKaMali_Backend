-- Add zone and service location tracking to orders table for location-specific analytics
ALTER TABLE orders 
    ADD COLUMN IF NOT EXISTS zone_id INT,
    ADD COLUMN IF NOT EXISTS service_latitude DECIMAL(10, 8),
    ADD COLUMN IF NOT EXISTS service_longitude DECIMAL(11, 8),
    ADD KEY idx_order_zone_id (zone_id),
    ADD CONSTRAINT fk_order_zone_id FOREIGN KEY (zone_id) REFERENCES service_zones(id) ON DELETE SET NULL;

-- ─── COMPLETE DATA CLEAR (with foreign key check disabled) ─────────────────────────────────
-- Uncomment below to clear ALL data including bookings and subscriptions:
/*
SET FOREIGN_KEY_CHECKS = 0;

DELETE FROM booking_logs;
DELETE FROM booking_addons;
DELETE FROM booking_tracking;
DELETE FROM bookings;
DELETE FROM subscriptions;
DELETE FROM order_items;
DELETE FROM orders;

ALTER TABLE booking_logs AUTO_INCREMENT = 1;
ALTER TABLE booking_addons AUTO_INCREMENT = 1;
ALTER TABLE booking_tracking AUTO_INCREMENT = 1;
ALTER TABLE bookings AUTO_INCREMENT = 1;
ALTER TABLE subscriptions AUTO_INCREMENT = 1;
ALTER TABLE order_items AUTO_INCREMENT = 1;
ALTER TABLE orders AUTO_INCREMENT = 1;

SET FOREIGN_KEY_CHECKS = 1;
*/
