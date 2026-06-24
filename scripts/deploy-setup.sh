#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# GharKaMali — NEW server one-time setup (run ONCE on the new Lightsail instance)
#
# SAFE TO RUN: this does NOT touch your already-migrated MySQL data or the
# /var/www/gharkamali/uploads folder. It only installs Node/PM2/Nginx, places
# the app code, writes .env, configures the reverse proxy, and starts PM2.
#
# Usage on the new instance (13.207.222.116):
#   bash deploy-setup.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

APP_DIR=/var/www/gharkamali
REPO=https://github.com/Souvik-Ghosh-js/GharKaMali_Backend.git
DOMAIN=gkm.gobt.in

echo "🚀 GharKaMali new-server setup starting..."

# ── 1. INSTALL NODE 20 + PM2 + NGINX (NOT MySQL — already migrated) ───────────
if ! command -v node >/dev/null 2>&1; then
  echo "📦 Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo apt-get install -y nginx
sudo npm install -g pm2
echo "✅ Node $(node -v), PM2, Nginx ready"

# ── 2. PLACE APP CODE (preserves existing uploads/) ──────────────────────────
sudo mkdir -p "$APP_DIR"
sudo chown -R ubuntu:ubuntu "$APP_DIR"
cd "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  echo "📥 Repo already here — pulling latest..."
  git fetch origin main && git reset --hard origin/main
else
  echo "📥 Cloning repo without disturbing uploads/..."
  git clone "$REPO" /tmp/gkm-clone
  mv /tmp/gkm-clone/.git "$APP_DIR/.git"
  rm -rf /tmp/gkm-clone
  git reset --hard origin/main
fi
npm install --production
echo "✅ Code in place + dependencies installed"

# ── 3. CREATE .env IF MISSING (root over socket; edit secrets after) ─────────
if [ ! -f "$APP_DIR/.env" ]; then
  echo "📝 Writing starter .env (EDIT secrets afterwards!)..."
  cat > "$APP_DIR/.env" <<ENVEOF
PORT=3000
NODE_ENV=production

DB_HOST=localhost
DB_PORT=3306
DB_NAME=gharkamali
DB_USER=root
DB_PASSWORD=

JWT_SECRET=CHANGE_ME_TO_A_LONG_RANDOM_STRING
JWT_EXPIRES_IN=30d

USE_STATIC_OTP=false
MSG91_AUTH_KEY=
MSG91_SENDER_ID=GHRMALI
MSG91_TEMPLATE_ID=

TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886

UPLOAD_PATH=$APP_DIR/uploads
BASE_URL=https://$DOMAIN

PLANT_ID_API_KEY=

ADMIN_URL=https://$DOMAIN
CUSTOMER_APP_URL=https://$DOMAIN
FRONTEND_URL=https://$DOMAIN

RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM="GharKaMali" <finance@gharkamali.com>
ADMIN_EMAIL=info@gharkamali.com
FINANCE_EMAIL=finance@gharkamali.com
EMAIL_LOGO_URL=https://gharkamali.com/logo.png
BRAND_NAME=GharKaMali
BRAND_TAGLINE=Your Garden, Our Care
BRAND_SITE=https://gharkamali.com
ENVEOF
  echo "⚠️  .env created with EMPTY secrets — fill them in with: nano $APP_DIR/.env"
else
  echo "✅ .env already exists — leaving it untouched"
fi

# ── 4. NGINX REVERSE PROXY ───────────────────────────────────────────────────
echo "🌐 Configuring Nginx for $DOMAIN..."
sudo tee /etc/nginx/sites-available/gharkamali > /dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    client_max_body_size 50M;

    location /uploads/ {
        alias $APP_DIR/uploads/;
    }

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF
sudo ln -sf /etc/nginx/sites-available/gharkamali /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx && sudo systemctl enable nginx
echo "✅ Nginx configured"

# ── 5. START APP WITH PM2 ────────────────────────────────────────────────────
sudo mkdir -p /var/log/gharkamali
sudo chown -R ubuntu:ubuntu /var/log/gharkamali
cd "$APP_DIR"
pm2 start ecosystem.config.js || pm2 restart gharkamali-backend
pm2 save
pm2 startup systemd -u ubuntu --hp /home/ubuntu | tail -1 | sudo bash || true
echo "✅ App started with PM2"

echo ""
echo "============================================================"
echo "✅ Phase 1 setup complete!"
echo ""
echo "Next steps (NOT done by this script):"
echo "  1. Edit secrets:    nano $APP_DIR/.env   then  pm2 restart gharkamali-backend"
echo "  2. Test locally:    curl http://localhost:3000/api-docs"
echo "  3. Point DNS A record for $DOMAIN -> this server's public IP"
echo "  4. Enable HTTPS:    sudo apt install -y certbot python3-certbot-nginx"
echo "                      sudo certbot --nginx -d $DOMAIN"
echo "  5. Update GitHub secrets: LIGHTSAIL_HOST / LIGHTSAIL_USER / LIGHTSAIL_SSH_KEY"
echo "============================================================"
