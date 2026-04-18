require('dotenv').config();
const { Sequelize } = require('sequelize');

// First connect without a database to create it if needed
async function ensureDatabase() {
  const rootConn = new Sequelize(
    '',
    process.env.DB_USER || 'root',
    process.env.DB_PASSWORD || '',
    {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 3306,
      dialect: 'mysql',
      logging: false,
    }
  );

  const dbName = process.env.DB_NAME || 'gharkamali';
  const dbUser = process.env.DB_USER || 'root';

  await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
  console.log(`  ✅ Database '${dbName}' ready`);

  // Grant all privileges to the user on this DB (useful if not root)
  if (dbUser !== 'root') {
    await rootConn.query(`GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${dbUser}'@'%';`);
    await rootConn.query(`FLUSH PRIVILEGES;`);
    console.log(`  ✅ Privileges granted to '${dbUser}'`);
  }

  await rootConn.close();
}

const sequelize = require('./database');

const tables = [

  // ── USERS ──────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS users (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(100)  NOT NULL,
    phone           VARCHAR(15)   NOT NULL UNIQUE,
    email           VARCHAR(100)  UNIQUE,
    password        VARCHAR(255),
    role            ENUM('admin','supervisor','gardener','customer') NOT NULL DEFAULT 'customer',
    is_active       TINYINT(1)    NOT NULL DEFAULT 1,
    is_approved     TINYINT(1)    NOT NULL DEFAULT 0,
    profile_image   VARCHAR(500),
    fcm_token       VARCHAR(500),
    otp             VARCHAR(10),
    otp_expires_at  DATETIME,
    last_login      DATETIME,
    latitude        DECIMAL(10,8),
    longitude       DECIMAL(11,8),
    address         TEXT,
    city            VARCHAR(100),
    state           VARCHAR(100),
    pincode         VARCHAR(10),
    wallet_balance  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    total_spent     DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    referral_code   VARCHAR(20)   UNIQUE,
    referred_by     INT,
    geofence_id     INT,
    service_zone_id INT,
    created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (referred_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_users_role     (role),
    INDEX idx_users_city     (city),
    INDEX idx_users_phone    (phone)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── GARDENER PROFILES ──────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS gardener_profiles (
    id                    INT AUTO_INCREMENT PRIMARY KEY,
    user_id               INT          NOT NULL UNIQUE,
    supervisor_id         INT,
    experience_years      INT          NOT NULL DEFAULT 0,
    bio                   TEXT,
    id_proof_type         VARCHAR(50),
    id_proof_image        VARCHAR(500),
    id_proof_number       VARCHAR(50),
    bank_account          VARCHAR(30),
    bank_ifsc             VARCHAR(15),
    bank_name             VARCHAR(100),
    rating                DECIMAL(3,2) NOT NULL DEFAULT 5.00,
    total_jobs            INT          NOT NULL DEFAULT 0,
    completed_jobs        INT          NOT NULL DEFAULT 0,
    cancelled_jobs        INT          NOT NULL DEFAULT 0,
    total_earnings        DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    pending_earnings      DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    is_available          TINYINT(1)   NOT NULL DEFAULT 1,
    current_latitude      DECIMAL(10,8),
    current_longitude     DECIMAL(11,8),
    last_location_update  DATETIME,
    created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)       REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_gp_supervisor   (supervisor_id),
    INDEX idx_gp_available    (is_available)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── WITHDRAWAL REQUESTS ────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS withdrawal_requests (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    gardener_id   INT           NOT NULL,
    amount        DECIMAL(10,2) NOT NULL,
    status        ENUM('pending','approved','rejected','processed') NOT NULL DEFAULT 'pending',
    bank_account  VARCHAR(30),
    bank_ifsc     VARCHAR(15),
    bank_name     VARCHAR(100),
    admin_notes   TEXT,
    processed_at  DATETIME,
    processed_by  INT,
    geofence_id   INT,
    created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (gardener_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (processed_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── REVIEWS ─────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS reviews (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    customer_id   INT           NOT NULL,
    booking_id    INT,
    gardener_id   INT,
    rating        INT           NOT NULL,
    comment       TEXT,
    status        ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
    admin_notes   TEXT,
    geofence_id   INT,
    created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES users(id)    ON DELETE CASCADE,
    FOREIGN KEY (booking_id)  REFERENCES bookings(id) ON DELETE SET NULL,
    FOREIGN KEY (gardener_id) REFERENCES users(id)    ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── TIPS ────────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS tips (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    booking_id    INT           NOT NULL,
    customer_id   INT           NOT NULL,
    gardener_id   INT           NOT NULL,
    amount        DECIMAL(10,2) NOT NULL,
    geofence_id   INT,
    created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id)  REFERENCES bookings(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES users(id)    ON DELETE CASCADE,
    FOREIGN KEY (gardener_id) REFERENCES users(id)    ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── CONTACT MESSAGES ────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS contact_messages (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    name          VARCHAR(100)  NOT NULL,
    email         VARCHAR(100),
    phone         VARCHAR(15),
    message       TEXT          NOT NULL,
    is_read       TINYINT(1)    NOT NULL DEFAULT 0,
    geofence_id   INT,
    created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── SERVICE ZONES ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS service_zones (
    id                   INT AUTO_INCREMENT PRIMARY KEY,
    name                 VARCHAR(100)  NOT NULL,
    city                 VARCHAR(100)  NOT NULL,
    state                VARCHAR(100)  NOT NULL,
    polygon_coordinates  JSON,
    center_latitude      DECIMAL(10,8),
    center_longitude     DECIMAL(11,8),
    radius_km            DECIMAL(5,2),
    is_active            TINYINT(1)    NOT NULL DEFAULT 1,
    base_price           DECIMAL(10,2) NOT NULL,
    price_per_plant      DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    min_plants           INT           NOT NULL DEFAULT 1,
    description          TEXT,
    created_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_zone_name_city (name, city),
    INDEX idx_sz_city     (city),
    INDEX idx_sz_active   (is_active)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── GARDENER ZONE ASSIGNMENTS ──────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS gardener_zones (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    gardener_id  INT NOT NULL,
    zone_id      INT NOT NULL,
    geofence_id  INT,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (gardener_id) REFERENCES users(id)         ON DELETE CASCADE,
    FOREIGN KEY (zone_id)     REFERENCES service_zones(id) ON DELETE CASCADE,
    UNIQUE KEY uq_gardener_zone (gardener_id, zone_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── SERVICE PLANS ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS service_plans (
    id                   INT AUTO_INCREMENT PRIMARY KEY,
    name                 VARCHAR(100) NOT NULL UNIQUE,
    description          TEXT,
    tagline              VARCHAR(255),
    plan_type            ENUM('subscription','ondemand') NOT NULL DEFAULT 'subscription',
    visits_per_month     INT          NOT NULL DEFAULT 8,
    price                DECIMAL(10,2) NOT NULL,
    price_subtitle       VARCHAR(50)   DEFAULT 'Every month',
    plan_summary         VARCHAR(100),
    price_per_visit      DECIMAL(10,2),
    is_best_value        TINYINT(1)    DEFAULT 0,
    button_text          VARCHAR(50)   DEFAULT 'Select',
    duration_days        INT          NOT NULL DEFAULT 30,
    is_active            TINYINT(1)   NOT NULL DEFAULT 1,
    features             JSON,
    max_plants           INT          NOT NULL DEFAULT 20,
    is_weekend_included  TINYINT(1)   NOT NULL DEFAULT 0,
    weekend_surge_price  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_sp_type    (plan_type),
    INDEX idx_sp_active  (is_active)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── SUBSCRIPTIONS ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS subscriptions (
    id                    INT AUTO_INCREMENT PRIMARY KEY,
    customer_id           INT          NOT NULL,
    plan_id               INT          NOT NULL,
    zone_id               INT,
    preferred_gardener_id INT,
    status                ENUM('active','paused','cancelled','expired') NOT NULL DEFAULT 'active',
    start_date            DATE         NOT NULL,
    end_date              DATE         NOT NULL,
    auto_renew            TINYINT(1)   NOT NULL DEFAULT 1,
    visits_used           INT          NOT NULL DEFAULT 0,
    visits_total          INT          NOT NULL,
    amount_paid           DECIMAL(10,2) NOT NULL,
    service_address       TEXT,
    service_latitude      DECIMAL(10,8),
    service_longitude     DECIMAL(11,8),
    plant_count           INT          NOT NULL DEFAULT 1,
    notes                 TEXT,
    payment_id            VARCHAR(100),
    geofence_id           INT,
    created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id)           REFERENCES users(id)         ON DELETE CASCADE,
    FOREIGN KEY (plan_id)               REFERENCES service_plans(id) ON DELETE RESTRICT,
    FOREIGN KEY (zone_id)               REFERENCES service_zones(id) ON DELETE SET NULL,
    FOREIGN KEY (preferred_gardener_id) REFERENCES users(id)         ON DELETE SET NULL,
    INDEX idx_sub_customer (customer_id),
    INDEX idx_sub_status   (status),
    INDEX idx_sub_end_date (end_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── BOOKINGS ───────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS bookings (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    booking_number      VARCHAR(20)   UNIQUE,
    customer_id         INT           NOT NULL,
    gardener_id         INT,
    subscription_id     INT,
    zone_id             INT,
    booking_type        ENUM('subscription','ondemand') NOT NULL DEFAULT 'ondemand',
    status              ENUM('pending','assigned','en_route','arrived','in_progress','completed','cancelled','failed') NOT NULL DEFAULT 'pending',
    scheduled_date      DATE          NOT NULL,
    scheduled_time      TIME,
    otp                 VARCHAR(6),
    otp_verified        TINYINT(1)    NOT NULL DEFAULT 0,
    otp_verified_at     DATETIME,
    assigned_at         DATETIME,
    en_route_at         DATETIME,
    started_at          DATETIME,
    completed_at        DATETIME,
    gardener_arrived_at DATETIME,
    rated_at            DATETIME,
    service_address     TEXT          NOT NULL,
    service_latitude    DECIMAL(10,8) NOT NULL,
    service_longitude   DECIMAL(11,8) NOT NULL,
    plant_count         INT           NOT NULL DEFAULT 1,
    extra_plants        INT           NOT NULL DEFAULT 0,
    base_amount         DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    extra_amount        DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    total_amount        DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    payment_status      ENUM('pending','paid','refunded') NOT NULL DEFAULT 'pending',
    before_image        VARCHAR(500),
    after_image         VARCHAR(500),
    gardener_notes      TEXT,
    customer_notes      TEXT,
    cancellation_reason TEXT,
    rating              INT,
    review              TEXT,
    rated_at            DATETIME,
    geofence_id         INT,
    created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id)     REFERENCES users(id)         ON DELETE CASCADE,
    FOREIGN KEY (gardener_id)     REFERENCES users(id)         ON DELETE SET NULL,
    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL,
    FOREIGN KEY (zone_id)         REFERENCES service_zones(id) ON DELETE SET NULL,
    INDEX idx_booking_customer     (customer_id),
    INDEX idx_booking_gardener     (gardener_id),
    INDEX idx_booking_status       (status),
    INDEX idx_booking_date         (scheduled_date),
    INDEX idx_booking_zone         (zone_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── BOOKING TRACKING (GPS trail) ───────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS booking_tracking (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    booking_id  INT           NOT NULL,
    gardener_id INT           NOT NULL,
    latitude    DECIMAL(10,8) NOT NULL,
    longitude   DECIMAL(11,8) NOT NULL,
    status      VARCHAR(50),
    created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id)  REFERENCES bookings(id) ON DELETE CASCADE,
    FOREIGN KEY (gardener_id) REFERENCES users(id)    ON DELETE CASCADE,
    INDEX idx_bt_booking (booking_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── NOTIFICATIONS ──────────────────────────────────────────────────────────
  `CREATE TABLE notifications (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    target_role ENUM('admin', 'customer', 'gardener', 'all', 'user') NOT NULL DEFAULT 'user',
    geofence_id INT,
    title      VARCHAR(200) NOT NULL,
    body       TEXT         NOT NULL,
    type       VARCHAR(50),
    data       JSON,
    is_read    TINYINT(1)   NOT NULL DEFAULT 0,
    read_at    DATETIME,
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (geofence_id) REFERENCES geofences(id) ON DELETE SET NULL,
    INDEX idx_notif_user    (user_id),
    INDEX idx_notif_is_read (is_read),
    INDEX idx_notif_geofence (geofence_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── REWARD / PENALTY ───────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS reward_penalties (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    gardener_id INT           NOT NULL,
    type        ENUM('reward','penalty') NOT NULL,
    amount      DECIMAL(10,2) NOT NULL,
    reason      VARCHAR(200)  NOT NULL,
    description TEXT,
    booking_id  INT,
    status      ENUM('pending','applied','reversed') NOT NULL DEFAULT 'pending',
    applied_at  DATETIME,
    geofence_id INT,
    created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (gardener_id) REFERENCES users(id)    ON DELETE CASCADE,
    FOREIGN KEY (booking_id)  REFERENCES bookings(id) ON DELETE SET NULL,
    INDEX idx_rp_gardener (gardener_id),
    INDEX idx_rp_type     (type)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── PLANT IDENTIFICATIONS ──────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS plant_identifications (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    user_id             INT           NOT NULL,
    image_url           VARCHAR(500)  NOT NULL,
    plant_name          VARCHAR(200),
    scientific_name     VARCHAR(200),
    description         TEXT,
    care_instructions   JSON,
    watering_schedule   VARCHAR(200),
    fertilizer_tips     TEXT,
    sunlight_requirement VARCHAR(100),
    confidence_score    DECIMAL(5,2),
    raw_response        JSON,
    geofence_id         INT,
    created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_pi_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── BLOGS ──────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS blogs (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    title           VARCHAR(300)  NOT NULL,
    slug            VARCHAR(300)  NOT NULL UNIQUE,
    content         LONGTEXT      NOT NULL,
    excerpt         TEXT,
    featured_image  VARCHAR(500),
    category        VARCHAR(100),
    tags            JSON,
    author_id       INT,
    status          ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
    seo_title       VARCHAR(300),
    seo_description TEXT,
    city_slug       VARCHAR(100),
    views           INT           NOT NULL DEFAULT 0,
    published_at    DATETIME,
    created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_blog_status    (status),
    INDEX idx_blog_slug      (slug),
    INDEX idx_blog_city_slug (city_slug),
    INDEX idx_blog_category  (category)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── CITY PAGES ─────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS city_pages (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    city_name        VARCHAR(100) NOT NULL,
    slug             VARCHAR(100) NOT NULL UNIQUE,
    state            VARCHAR(100),
    hero_title       VARCHAR(300),
    hero_description TEXT,
    content          LONGTEXT,
    seo_title        VARCHAR(300),
    seo_description  TEXT,
    is_active        TINYINT(1)   NOT NULL DEFAULT 1,
    total_gardeners  INT          NOT NULL DEFAULT 0,
    total_customers  INT          NOT NULL DEFAULT 0,
    created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_cp_slug   (slug),
    INDEX idx_cp_active (is_active)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── PAYMENTS ───────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS payments (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    user_id          INT           NOT NULL,
    booking_id       INT,
    subscription_id  INT,
    amount           DECIMAL(10,2) NOT NULL,
    type             ENUM('booking','subscription','refund','wallet_topup') NOT NULL,
    status           ENUM('pending','success','failed','refunded') NOT NULL DEFAULT 'pending',
    payment_method   VARCHAR(50),
    transaction_id   VARCHAR(100),
    txn_id           VARCHAR(100),
    payment_for      VARCHAR(100),
    gateway_response JSON,
    notes            TEXT,
    geofence_id      INT,
    created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)         REFERENCES users(id)         ON DELETE CASCADE,
    FOREIGN KEY (booking_id)      REFERENCES bookings(id)      ON DELETE SET NULL,
    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL,
    INDEX idx_pay_user   (user_id),
    INDEX idx_pay_status (status),
    INDEX idx_pay_txn    (transaction_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── PRICE HIKE LOGS ────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS price_hike_logs (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    zone_id          INT,
    plan_id          INT,
    old_price        DECIMAL(10,2),
    new_price        DECIMAL(10,2),
    hike_percentage  DECIMAL(5,2),
    reason           VARCHAR(200),
    applied_by       INT,
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (zone_id)    REFERENCES service_zones(id) ON DELETE SET NULL,
    FOREIGN KEY (plan_id)    REFERENCES service_plans(id) ON DELETE SET NULL,
    FOREIGN KEY (applied_by) REFERENCES users(id)         ON DELETE SET NULL,
    INDEX idx_phl_zone (zone_id),
    INDEX idx_phl_plan (plan_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── PRICE HIKE SCHEDULES ───────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS price_hike_schedules (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    name         VARCHAR(100),
    zone_ids     JSON,
    plan_ids     JSON,
    percentage   DECIMAL(5,2) NOT NULL,
    reason       VARCHAR(200),
    scheduled_at DATETIME     NOT NULL,
    is_applied   TINYINT(1)   NOT NULL DEFAULT 0,
    applied_at   DATETIME,
    created_by   INT,
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_phs_scheduled_at (scheduled_at),
    INDEX idx_phs_is_applied   (is_applied)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── COMPLAINTS ─────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS complaints (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    booking_id       INT,
    customer_id      INT          NOT NULL,
    gardener_id      INT,
    assigned_to      INT,
    type             ENUM('service_quality','late_arrival','no_show','rude_behavior','billing','damage','other') NOT NULL,
    description      TEXT         NOT NULL,
    status           ENUM('open','in_review','resolved','closed') NOT NULL DEFAULT 'open',
    priority         ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
    resolution_notes TEXT,
    resolved_at      DATETIME,
    resolved_by      INT,
    geofence_id      INT,
    created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id)  REFERENCES bookings(id) ON DELETE SET NULL,
    FOREIGN KEY (customer_id) REFERENCES users(id)    ON DELETE CASCADE,
    FOREIGN KEY (gardener_id) REFERENCES users(id)    ON DELETE SET NULL,
    FOREIGN KEY (assigned_to) REFERENCES users(id)    ON DELETE SET NULL,
    FOREIGN KEY (resolved_by) REFERENCES users(id)    ON DELETE SET NULL,
    INDEX idx_complaint_customer    (customer_id),
    INDEX idx_complaint_status      (status),
    INDEX idx_complaint_assigned_to (assigned_to)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── SLA CONFIG ─────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS sla_configs (
    id                       INT AUTO_INCREMENT PRIMARY KEY,
    max_arrival_delay_mins   INT          NOT NULL DEFAULT 30,
    max_service_duration_hrs DECIMAL(4,1) NOT NULL DEFAULT 3.0,
    response_time_hrs        INT          NOT NULL DEFAULT 24,
    is_active                TINYINT(1)   NOT NULL DEFAULT 1,
    updated_by               INT,
    created_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── SLA BREACHES ───────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS sla_breaches (
    id                   INT AUTO_INCREMENT PRIMARY KEY,
    booking_id           INT          NOT NULL,
    gardener_id          INT,
    breach_type          ENUM('late_arrival','service_overtime','no_start','no_completion') NOT NULL,
    expected_by          DATETIME,
    detected_at          DATETIME,
    delay_minutes        INT,
    supervisor_notified  TINYINT(1)   NOT NULL DEFAULT 0,
    is_resolved          TINYINT(1)   NOT NULL DEFAULT 0,
    resolved_at          DATETIME,
    created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id)  REFERENCES bookings(id) ON DELETE CASCADE,
    FOREIGN KEY (gardener_id) REFERENCES users(id)    ON DELETE SET NULL,
    INDEX idx_slab_booking     (booking_id),
    INDEX idx_slab_is_resolved (is_resolved)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── ADD-ON SERVICES ────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS addon_services (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    name          VARCHAR(100)  NOT NULL UNIQUE,
    description   TEXT,
    price         DECIMAL(10,2) NOT NULL,
    duration_mins INT           NOT NULL DEFAULT 30,
    icon          VARCHAR(10)   NOT NULL DEFAULT '🌿',
    is_active     TINYINT(1)    NOT NULL DEFAULT 1,
    category      VARCHAR(50),
    created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_addon_category (category),
    INDEX idx_addon_active   (is_active)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── BOOKING ADD-ONS ────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS booking_addons (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    booking_id INT           NOT NULL,
    addon_id   INT           NOT NULL,
    quantity   INT           NOT NULL DEFAULT 1,
    price      DECIMAL(10,2) NOT NULL,
    status     ENUM('pending','completed') NOT NULL DEFAULT 'pending',
    created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings(id)       ON DELETE CASCADE,
    FOREIGN KEY (addon_id)   REFERENCES addon_services(id) ON DELETE CASCADE,
    INDEX idx_ba_booking (booking_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`

];

async function migrate() {
  try {
    await ensureDatabase();
    await sequelize.authenticate();
    console.log('Database connected.\n');

    for (const sql of tables) {
      // Extract table name from SQL for logging
      const match = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
      const tableName = match ? match[1] : '?';
      await sequelize.query(sql);
      console.log(`  ✅ ${tableName}`);
    }

    console.log(`\n✅ Migration complete — ${tables.length} tables ready.`);
    console.log('   Run: npm run seed\n');
    process.exit(0);
  } catch (error) {
    console.error('\nMigration failed:', error.message);
    process.exit(1);
  }
}

migrate();
