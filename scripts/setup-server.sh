#!/bin/bash
set -e

echo "🚀 Setting up GharKaMali Backend Server..."

# ── UPDATE SYSTEM ──────────────────────────────────────────────────────────────
sudo apt-get update -y && sudo apt-get upgrade -y

# ── INSTALL NODE.JS 20 LTS ─────────────────────────────────────────────────────
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
echo "✅ Node.js $(node -v) installed"

# ── INSTALL PM2 ────────────────────────────────────────────────────────────────
sudo npm install -g pm2
echo "✅ PM2 installed"

# ── INSTALL MYSQL ──────────────────────────────────────────────────────────────
sudo apt-get install -y mysql-server
sudo systemctl start mysql
sudo systemctl enable mysql
echo "✅ MySQL installed and started"

# Secure MySQL and create database
sudo mysql -e "CREATE DATABASE IF NOT EXISTS gharkamali CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "CREATE USER IF NOT EXISTS 'gharkamali'@'localhost' IDENTIFIED BY 'GharKaMali@2024!';"
sudo mysql -e "GRANT ALL PRIVILEGES ON gharkamali.* TO 'gharkamali'@'localhost';"
sudo mysql -e "FLUSH PRIVILEGES;"
echo "✅ MySQL database 'gharkamali' and user created"

# ── INSTALL NGINX ──────────────────────────────────────────────────────────────
sudo apt-get install -y nginx

sudo tee /etc/nginx/sites-available/gharkamali > /dev/null <<'EOF'
server {
    listen 80;
    server_name _;

    client_max_body_size 50M;

    location /uploads/ {
        alias /var/www/gharkamali/uploads/;
    }

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/gharkamali /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx && sudo systemctl enable nginx
echo "✅ Nginx configured"

# ── CREATE APP DIRECTORY ───────────────────────────────────────────────────────
sudo mkdir -p /var/www/gharkamali
sudo mkdir -p /var/www/gharkamali/uploads
sudo chown -R ubuntu:ubuntu /var/www/gharkamali
echo "✅ App directory created"

# ── CLONE REPO ─────────────────────────────────────────────────────────────────
# Replace YOUR_GITHUB_USERNAME and YOUR_REPO_NAME below
cd /var/www/gharkamali
git clone https://github.com/Souvik-Ghosh-js/GharKaMali_Backend.git .

# ── INSTALL DEPENDENCIES ───────────────────────────────────────────────────────
npm install --production
echo "✅ Dependencies installed"

# ── CREATE .env ────────────────────────────────────────────────────────────────
cat > /var/www/gharkamali/.env <<'ENVEOF'
PORT=3000
NODE_ENV=production

DB_HOST=localhost
DB_PORT=3306
DB_NAME=gharkamali
DB_USER=gharkamali
DB_PASSWORD=GharKaMali@2024!

JWT_SECRET=CHANGE_THIS_TO_A_LONG_RANDOM_STRING
JWT_EXPIRES_IN=30d

USE_STATIC_OTP=false
MSG91_AUTH_KEY=your-msg91-auth-key
MSG91_SENDER_ID=GHRMALI
MSG91_TEMPLATE_ID=your-template-id

TWILIO_ACCOUNT_SID=your-twilio-account-sid
TWILIO_AUTH_TOKEN=your-twilio-auth-token
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886

UPLOAD_PATH=/var/www/gharkamali/uploads
BASE_URL=http://13.201.162.125

PLANT_ID_API_KEY=your-plant-id-api-key

ADMIN_URL=http://13.201.162.125
CUSTOMER_APP_URL=http://13.201.162.125
FRONTEND_URL=http://13.201.162.125

PAYU_MERCHANT_KEY=your-payu-merchant-key
PAYU_MERCHANT_SALT=your-payu-merchant-salt
PAYU_MODE=test
ENVEOF

echo "✅ .env file created — EDIT IT NOW with real values!"

# ── START APP WITH PM2 ─────────────────────────────────────────────────────────
pm2 start /var/www/gharkamali/ecosystem.config.js
pm2 save
pm2 startup systemd -u ubuntu --hp /home/ubuntu | tail -1 | sudo bash
echo "✅ App started with PM2"

# ── OPEN FIREWALL PORTS ────────────────────────────────────────────────────────
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
echo "✅ Firewall configured"

echo ""
echo "============================================"
echo "✅ Setup complete!"
echo "API: http://13.201.162.125"
echo "Docs: http://13.201.162.125/api-docs"
echo "============================================"
echo "IMPORTANT: Edit /var/www/gharkamali/.env with real API keys!"
