-- =====================================================================
-- Complaint Ticketing System Migration
-- Run order: top to bottom. All statements are idempotent where possible.
-- =====================================================================

-- 1) Departments
CREATE TABLE IF NOT EXISTS complaint_departments (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(80)  NOT NULL UNIQUE,
  description VARCHAR(255) NULL,
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO complaint_departments (name, description) VALUES
  ('Customer Care',  'General customer queries and first-level support'),
  ('Operations',     'Bookings, scheduling, gardener performance'),
  ('Billing',        'Payments, refunds, invoicing'),
  ('Technical',      'App / website bugs and access issues'),
  ('Quality',        'Service quality, escalations, audits');

-- 2) Comments (thread)
CREATE TABLE IF NOT EXISTS complaint_comments (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  complaint_id  INT NOT NULL,
  user_id       INT NOT NULL,
  user_role     ENUM('admin','supervisor','gardener','customer') NOT NULL,
  comment       TEXT NOT NULL,
  is_internal   TINYINT(1) NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_complaint (complaint_id),
  INDEX idx_user (user_id),
  CONSTRAINT fk_cc_complaint FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE,
  CONSTRAINT fk_cc_user      FOREIGN KEY (user_id)      REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) Attachments
CREATE TABLE IF NOT EXISTS complaint_attachments (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  complaint_id  INT NOT NULL,
  comment_id    INT NULL,
  uploaded_by   INT NOT NULL,
  file_url      VARCHAR(500) NOT NULL,
  file_name     VARCHAR(255) NOT NULL,
  file_type     VARCHAR(100) NULL,
  file_size     INT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_complaint (complaint_id),
  INDEX idx_comment (comment_id),
  CONSTRAINT fk_ca_complaint FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE,
  CONSTRAINT fk_ca_comment   FOREIGN KEY (comment_id)   REFERENCES complaint_comments(id) ON DELETE SET NULL,
  CONSTRAINT fk_ca_user      FOREIGN KEY (uploaded_by)  REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4) Status history (audit trail)
CREATE TABLE IF NOT EXISTS complaint_status_history (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  complaint_id  INT NOT NULL,
  from_status   VARCHAR(40) NULL,
  to_status     VARCHAR(40) NOT NULL,
  changed_by    INT NULL,
  note          VARCHAR(500) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_complaint (complaint_id),
  CONSTRAINT fk_csh_complaint FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE,
  CONSTRAINT fk_csh_user      FOREIGN KEY (changed_by)   REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5) Extend complaints table
ALTER TABLE complaints
  ADD COLUMN ticket_number VARCHAR(20)  NULL AFTER id,
  ADD COLUMN subject       VARCHAR(255) NULL AFTER ticket_number,
  ADD COLUMN department_id INT NULL AFTER assigned_to,
  ADD COLUMN due_date      DATETIME NULL AFTER priority,
  ADD UNIQUE KEY uniq_ticket_number (ticket_number),
  ADD INDEX idx_department (department_id),
  ADD CONSTRAINT fk_complaint_dept FOREIGN KEY (department_id) REFERENCES complaint_departments(id);

-- 6) Expand status ENUM
ALTER TABLE complaints
  MODIFY COLUMN status
    ENUM('open','in_progress','awaiting_customer','in_review','resolved','closed','reopened')
    NOT NULL DEFAULT 'open';

-- 7) Backfill ticket numbers for existing rows (format: TKT-000001)
UPDATE complaints
SET ticket_number = CONCAT('TKT-', LPAD(id, 6, '0'))
WHERE ticket_number IS NULL;
