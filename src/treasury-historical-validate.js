// Pre-payment validation for POST /v1/treasury/yield-curve/historical.
// Kept in its own module so it can be unit-tested without booting server.js.

const MAX_RANGE_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Strict YYYY-MM-DD -> UTC-midnight timestamp, or null. `new Date(str)` is
// not used because it parses date-times without an offset in the host's
// local timezone (skewing the day count) and accepts garbage / rollover dates.
function parseIsoDate(value) {
  if (typeof value !== 'string') return null;
  const m = ISO_DATE.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const ts = Date.UTC(year, month, day);
  const d = new Date(ts);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month || d.getUTCDate() !== day) return null;
  return ts;
}

function preValidateTreasuryHistorical(req, res, next) {
  const { start_date, end_date } = req.body || {};

  if (!start_date || !end_date) {
    return res.status(400).json({
      error: { code: 'MISSING_PARAMS', message: 'start_date and end_date required (ISO format YYYY-MM-DD)' }
    });
  }

  const start = parseIsoDate(start_date);
  const end = parseIsoDate(end_date);

  if (start === null || end === null) {
    return res.status(400).json({
      error: { code: 'INVALID_DATE', message: 'start_date and end_date must be valid dates in YYYY-MM-DD format' }
    });
  }

  const daysDiff = (end - start) / MS_PER_DAY;

  if (daysDiff > MAX_RANGE_DAYS) {
    return res.status(400).json({
      error: { code: 'RANGE_TOO_LARGE', message: 'Date range cannot exceed 90 days' }
    });
  }

  if (daysDiff < 0) {
    return res.status(400).json({
      error: { code: 'INVALID_RANGE', message: 'start_date must be before end_date' }
    });
  }

  next();
}

module.exports = { preValidateTreasuryHistorical, parseIsoDate, MAX_RANGE_DAYS };
