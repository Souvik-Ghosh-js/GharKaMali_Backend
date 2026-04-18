-- Add zone and service location tracking to orders table for location-specific analytics
ALTER TABLE orders 
    ADD COLUMN IF NOT EXISTS zone_id INT,
    ADD COLUMN IF NOT EXISTS service_latitude DECIMAL(10, 8),
    ADD COLUMN IF NOT EXISTS service_longitude DECIMAL(11, 8),
    ADD KEY idx_order_zone_id (zone_id),
    ADD CONSTRAINT fk_order_zone_id FOREIGN KEY (zone_id) REFERENCES service_zones(id) ON DELETE SET NULL;
