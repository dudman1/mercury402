// Mercury402 x402 Payment Service — PM2 Ecosystem Config
// Used with: pm2 start ecosystem.config.js
// Or to update the existing process: pm2 delete mercury402-server && pm2 start ecosystem.config.js
//
// wait_ready: true prevents PM2 from marking the process "online" until the
// app calls process.send('ready'). This avoids the reboot race where PM2
// resurrects before the network stack is ready.
//
// listen_timeout: 30000 gives 30s for the app to bind its port before PM2
// considers it a startup failure and retries.
//
// max_restarts: 5 with 10s restart_delay caps the error-loop spam seen
// with the 2.5M-line provider-failure logs.
//
// restart_delay: 10s gives the old process time to die and release its port
// before the new one tries to bind. Without this, rapid restarts hit
// EADDRINUSE on port 4020.
//
// min_uptime: 5000 prevents PM2 from entering "unstable restart" mode on
// fast exits during the boot race.

module.exports = {
  apps: [{
    name: 'mercury402-server',
    script: 'src/server.js',
    cwd: '/Users/openclaw/mercury-x402-service',
    interpreter: 'node',
    node_args: '',
    env: {
      NODE_ENV: 'production'
    },
    // Startup gating
    wait_ready: true,
    listen_timeout: 30000,
    // Restart policy — caps the error-loop spam
    max_restarts: 5,
    restart_delay: 10000,
    min_uptime: 5000,
    // Logging
    out_file: '/Users/openclaw/.pm2/logs/mercury402-server-out.log',
    error_file: '/Users/openclaw/.pm2/logs/mercury402-server-error.log',
    merge_logs: true,
    // Production mode — no watch
    watch: false,
    autorestart: true,
    // Kill timeout: 15s window for the SIGTERM handler to drain in-flight
    // transferWithAuthorization settlements (server.js ~L3494).
    kill_timeout: 15000,
  }]
};
