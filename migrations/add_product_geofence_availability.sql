-- ─────────────────────────────────────────────────────────────────────────────
-- GharKaMali — Migration: Add available_geofence_ids to products table
-- Run once on the production database to enable location-based availability.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS available_geofence_ids JSON DEFAULT NULL
  COMMENT 'NULL = available everywhere; JSON array of geofence IDs restricts delivery to those areas only';
