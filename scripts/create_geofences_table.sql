-- Run this once on your MySQL database (production & staging)
-- Creates the geofences table used by the new Geofencing admin page

CREATE TABLE IF NOT EXISTS `geofences` (
  `id`             INT            NOT NULL AUTO_INCREMENT,
  `name`           VARCHAR(100)   NOT NULL,
  `city`           VARCHAR(100)   NOT NULL,
  `state`          VARCHAR(100)   DEFAULT '',
  `polygon_coords` LONGTEXT       NOT NULL  COMMENT 'JSON array of [lat, lng] pairs',
  `is_active`      TINYINT(1)     NOT NULL  DEFAULT 1,
  `created_by`     INT            DEFAULT NULL,
  `createdAt`      DATETIME       NOT NULL  DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`      DATETIME       NOT NULL  DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
