/** PM2 process file — used by GitHub Actions deploy and manual restarts. */
module.exports = {
  apps: [
    {
      name: process.env.PM2_APP_NAME || 'mobiledjay',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '750M',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
