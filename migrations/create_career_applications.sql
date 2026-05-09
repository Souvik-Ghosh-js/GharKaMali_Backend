-- Career applications table for gardener job applications
CREATE TABLE IF NOT EXISTS career_applications (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(120)  NOT NULL,
  phone        VARCHAR(15)   NOT NULL,
  whatsapp     VARCHAR(15)   NULL,
  email        VARCHAR(120)  NULL,
  experience   VARCHAR(60)   NOT NULL,
  cities       TEXT          NOT NULL,
  bio          TEXT          NULL,
  status       ENUM('new','contacted','hired','rejected') NOT NULL DEFAULT 'new',
  notes        TEXT          NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
