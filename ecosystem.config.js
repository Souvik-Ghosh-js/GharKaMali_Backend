module.exports = {
  apps: [
    {
      name: 'gharkamali-backend',
      script: 'src/index.js',
      cwd: '/var/www/gharkamali',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: '/var/log/gharkamali/error.log',
      out_file: '/var/log/gharkamali/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
