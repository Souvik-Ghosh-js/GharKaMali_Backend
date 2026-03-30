-- Run this once on your MySQL database (production & staging)
-- Creates the geofences table — replaces the radius-based service_zones CRUD
-- (service_zones table is retained for backward-compat with existing bookings)

CREATE TABLE IF NOT EXISTS `geofences` (
  `id`              INT             NOT NULL AUTO_INCREMENT,
  `name`            VARCHAR(100)    NOT NULL,
  `city`              VARCHAR(100)    NOT NULL,
  `state`           VARCHAR(100)    DEFAULT '',
  `polygon_coords`  LONGTEXT        NOT NULL  COMMENT 'JSON array of [lat, lng] pairs — unlimited vertices',
  `is_active`       TINYINT(1)      NOT NULL  DEFAULT 1,
  -- Pricing fields (replaces service_zones pricing)
  `base_price`      DECIMAL(10, 2)  NOT NULL  DEFAULT 0.00,
  `price_per_plant` DECIMAL(10, 2)  NOT NULL  DEFAULT 0.00,
  `min_plants`      INT             NOT NULL  DEFAULT 1,
  `created_by`      INT             DEFAULT NULL,
  `created_at`       DATETIME        NOT NULL  DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME        NOT NULL  DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_geofences_city` (`city`),
  KEY `idx_geofences_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
