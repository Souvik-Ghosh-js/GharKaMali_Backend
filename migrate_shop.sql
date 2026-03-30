-- ============================================================
-- GharKaMali Shop/Marketplace Database Migration
-- Run this on your AWS Lightsail MySQL instance
-- ============================================================

-- 1. Product Categories
CREATE TABLE IF NOT EXISTS `product_categories` (
  `id`         INT            NOT NULL AUTO_INCREMENT,
  `name`       VARCHAR(100)   NOT NULL,
  `slug`       VARCHAR(100)   DEFAULT NULL,
  `icon`       VARCHAR(50)    DEFAULT NULL,
  `is_active`  TINYINT(1)     NOT NULL DEFAULT 1,
  `created_at` DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`),
  UNIQUE KEY `slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Products
CREATE TABLE IF NOT EXISTS `products` (
  `id`             INT              NOT NULL AUTO_INCREMENT,
  `category_id`    INT              DEFAULT NULL,
  `name`           VARCHAR(200)     NOT NULL,
  `slug`           VARCHAR(200)     DEFAULT NULL,
  `description`    TEXT             DEFAULT NULL,
  `price`          DECIMAL(10, 2)   NOT NULL,
  `mrp`            DECIMAL(10, 2)   DEFAULT NULL,
  `stock_quantity` INT              NOT NULL DEFAULT 0,
  `images`         JSON             DEFAULT NULL,
  `icon_key`       VARCHAR(50)      DEFAULT NULL,
  `badge`          VARCHAR(50)      DEFAULT NULL,
  `rating`         DECIMAL(3, 2)    NOT NULL DEFAULT 0.00,
  `review_count`   INT              NOT NULL DEFAULT 0,
  `is_active`      TINYINT(1)       NOT NULL DEFAULT 1,
  `created_at`     DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`),
  CONSTRAINT `fk_product_category` FOREIGN KEY (`category_id`)
    REFERENCES `product_categories` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Orders
CREATE TABLE IF NOT EXISTS `orders` (
  `id`               INT              NOT NULL AUTO_INCREMENT,
  `order_number`     VARCHAR(20)      DEFAULT NULL,
  `customer_id`      INT              NOT NULL,
  `total_amount`     DECIMAL(10, 2)   NOT NULL,
  `status`           ENUM('pending','processing','shipped','delivered','cancelled','returned')
                     NOT NULL DEFAULT 'pending',
  `payment_status`   ENUM('pending','paid','failed','refunded')
                     NOT NULL DEFAULT 'pending',
  `payment_id`       VARCHAR(100)     DEFAULT NULL,
  `shipping_address` TEXT             NOT NULL,
  `shipping_city`    VARCHAR(100)     DEFAULT NULL,
  `shipping_pincode` VARCHAR(15)      DEFAULT NULL,
  `notes`            TEXT             DEFAULT NULL,
  `created_at`       DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `order_number` (`order_number`),
  CONSTRAINT `fk_order_customer` FOREIGN KEY (`customer_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. Order Items
CREATE TABLE IF NOT EXISTS `order_items` (
  `id`         INT            NOT NULL AUTO_INCREMENT,
  `order_id`   INT            NOT NULL,
  `product_id` INT            NOT NULL,
  `quantity`   INT            NOT NULL DEFAULT 1,
  `price`      DECIMAL(10, 2) NOT NULL,
  `created_at` DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_item_order`   FOREIGN KEY (`order_id`)   REFERENCES `orders`   (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_item_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- Seed: Product Categories
-- ============================================================
INSERT IGNORE INTO `product_categories` (`name`, `slug`, `icon`, `is_active`) VALUES
  ('Plants',          'plants',          '🌿', 1),
  ('Pots & Planters', 'pots-planters',   '🏺', 1),
  ('Soil & Compost',  'soil-compost',    '🟤', 1),
  ('Fertilizers',     'fertilizers',     '🧪', 1),
  ('Tools',           'tools',           '🛠️', 1),
  ('Pest Control',    'pest-control',    '🕸️', 1);

-- ============================================================
-- Seed: Products (reference @category_id from above inserts)
-- ============================================================
INSERT IGNORE INTO `products`
  (`name`, `slug`, `description`, `price`, `mrp`, `stock_quantity`, `icon_key`, `badge`, `rating`, `review_count`, `is_active`, `category_id`)
SELECT
  p.name, p.slug, p.description, p.price, p.mrp, p.stock_quantity, p.icon_key, p.badge, p.rating, p.review_count, 1, c.id
FROM (
  SELECT 'Premium Organic Potting Mix' AS name, 'premium-organic-potting-mix' AS slug,
         'Rich organic blend with perlite, vermiculite & slow-release nutrients.' AS description,
         499 AS price, 699 AS mrp, 50 AS stock_quantity, 'soil' AS icon_key, 'Bestseller' AS badge,
         4.80 AS rating, 234 AS review_count, 'Soil & Compost' AS cat_name
  UNION ALL
  SELECT 'Neem Oil Concentrate 500ml', 'neem-oil-concentrate-500ml',
         '100% cold-pressed neem oil. Natural pesticide & fungicide.',
         299, 399, 50, 'pest', 'Organic', 4.70, 189, 'Pest Control'
  UNION ALL
  SELECT 'Handcrafted Terracotta Pot Set (3pc)', 'handcrafted-terracotta-pot-set-3pc',
         'Set of 3 artisan terracotta pots (4", 6", 8"). Perfect drainage.',
         899, 1299, 50, 'pot', 'Handcrafted', 4.90, 156, 'Pots & Planters'
  UNION ALL
  SELECT 'Plant Growth Booster — NPK 19:19:19', 'plant-growth-booster-npk-19-19-19',
         'Balanced water-soluble fertilizer for all stages of growth.',
         649, 849, 50, 'fert', 'Top Rated', 4.60, 312, 'Fertilizers'
  UNION ALL
  SELECT 'Monstera Deliciosa (Medium)', 'monstera-deliciosa-medium',
         'Beautiful split-leaf monstera. 30-40cm height, healthy root system.',
         1299, 1800, 30, 'plant', 'Popular', 4.90, 428, 'Plants'
  UNION ALL
  SELECT 'Pruning Shears — Premium Steel', 'pruning-shears-premium-steel',
         'Japanese SK-5 high carbon steel blades. Ergonomic rubber grip.',
         799, 999, 40, 'tool', 'Professional', 4.80, 97, 'Tools'
  UNION ALL
  SELECT 'Peace Lily Indoor Plant', 'peace-lily-indoor-plant',
         'NASA-certified air purifying plant. Low maintenance, thrives in low light.',
         699, 999, 35, 'plant', 'Air Purifier', 4.70, 345, 'Plants'
  UNION ALL
  SELECT 'Drip Irrigation Kit (Garden)', 'drip-irrigation-kit-garden',
         'Complete drip system for up to 20 plants. Includes timer & emitters.',
         1899, 2499, 20, 'tool', 'DIY Kit', 4.50, 78, 'Tools'
) p
JOIN `product_categories` c ON c.name = p.cat_name;
