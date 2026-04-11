const routeCache = new Map();

const clonePayload = (value) => JSON.parse(JSON.stringify(value));

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of routeCache.entries()) {
    if (entry.expiresAt <= now) {
      routeCache.delete(key);
    }
  }
}, 30000).unref();

const buildRouteCache = ({ ttlMs = 15000, keyBuilder } = {}) => (req, res, next) => {
  if (req.method !== 'GET') {
    next();
    return;
  }

  const cacheKey = keyBuilder
    ? keyBuilder(req)
    : `${req.originalUrl}|${req.user?._id?.toString() || 'guest'}`;
  const cached = routeCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    res.set('X-Route-Cache', 'HIT');
    res.status(cached.statusCode).json(clonePayload(cached.body));
    return;
  }

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode < 400) {
      routeCache.set(cacheKey, {
        expiresAt: Date.now() + ttlMs,
        statusCode: res.statusCode,
        body: clonePayload(body),
      });
      res.set('X-Route-Cache', 'MISS');
    }
    return originalJson(body);
  };

  next();
};

module.exports = { buildRouteCache };