// Last-resort error handling for src/server.js.
//
// errorHandler: Express error middleware, registered after every route. Logs
// the error server-side and answers with a fixed JSON body, so clients never
// see a stack trace, env value or file path. Client errors raised by Express
// middleware (e.g. malformed JSON from express.json(), flagged expose: true)
// keep their 4xx status; everything else is a 500.
//
// installProcessGuards: unhandled rejections are logged; an uncaught exception
// is logged and the process exits 1 so PM2 restarts it from a clean state.

function log(label, err) {
  console.error(`[${new Date().toISOString()}] ${label}:`, err && err.stack ? err.stack : err);
}

function errorHandler(err, req, res, next) {
  log(`Unhandled error on ${req.method} ${req.originalUrl}`, err);
  if (res.headersSent) return next(err);
  const status = err && err.expose && err.status >= 400 && err.status < 500 ? err.status : 500;
  res.status(status).json({ error: status === 500 ? 'internal_error' : 'invalid_request' });
}

function installProcessGuards(proc = process) {
  proc.on('unhandledRejection', (reason) => log('unhandledRejection', reason));
  proc.on('uncaughtException', (err) => {
    log('uncaughtException', err);
    proc.exit(1);
  });
}

module.exports = { errorHandler, installProcessGuards };
