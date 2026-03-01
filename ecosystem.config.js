module.exports = {
  apps: [
    {
      name: 'mercury402-server',
      script: 'src/server.js',
      cwd: '/Users/openclaw/mercury-x402-service',

      // Give the old process time to die and release its port before
      // the new one tries to bind. Without this, rapid restarts hit
      // EADDRINUSE on port 4020.
      restart_delay: 4000,

      // Wait at least this long before considering the process stable.
      // Prevents PM2 from entering "unstable restart" mode on fast exits.
      min_uptime: 5000,

      // Give the process 3 s to exit gracefully on SIGTERM before SIGKILL.
      kill_timeout: 3000,

      // Cap automatic restarts so runaway failures don't loop forever.
      max_restarts: 15,

      autorestart: true,
      watch: false,

      // Load .env from the project root
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
