// Per-address rate limiting for the routes a guesser would hammer.
//
// Kept in memory: the app runs as a single process, and losing the counts on a
// restart costs nothing worth a Redis dependency. The per-account lockouts in
// routes/auth.js live in the database and do survive restarts; this is the
// layer in front of them that stops one address trying many accounts.

function rateLimit({ windowMs, max, message }) {
  // address -> timestamps of recent hits, oldest first
  const hits = new Map();

  // Without this the map only ever grows.
  const sweep = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, times] of hits) {
      if (times[times.length - 1] <= cutoff) hits.delete(key);
    }
  }, windowMs);
  sweep.unref();

  return function limit(req, res, next) {
    const key = req.ip || req.socket?.remoteAddress || "unknown";
    const now = Date.now();
    const cutoff = now - windowMs;

    const times = (hits.get(key) || []).filter((t) => t > cutoff);
    if (times.length >= max) {
      const retryAfter = Math.max(1, Math.ceil((times[0] + windowMs - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      hits.set(key, times);
      return res.status(429).json({ error: message, retryAfter });
    }

    times.push(now);
    hits.set(key, times);
    next();
  };
}

module.exports = { rateLimit };
