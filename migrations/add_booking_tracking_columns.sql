-- Add missing columns to bookings table for enhanced service tracking
ALTER TABLE bookings 
    ADD COLUMN IF NOT EXISTS assigned_at DATETIME,
    ADD COLUMN IF NOT EXISTS en_route_at DATETIME,
    ADD COLUMN IF NOT EXISTS started_at DATETIME,
    ADD COLUMN IF NOT EXISTS completed_at DATETIME,
    ADD COLUMN IF NOT EXISTS gardener_arrived_at DATETIME,
    ADD COLUMN IF NOT EXISTS rated_at DATETIME;
