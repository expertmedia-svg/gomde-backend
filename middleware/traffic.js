const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const buildActorKey = (req) => {
  const authHeader = req.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return `bearer:${crypto.createHash('sha1').update(authHeader.slice(7)).digest('hex')}`;
  }
  return req.ip;
};

const buildActionLimiter = ({
  windowMs,
  max,
  prefix,
  paramName,
  message,
}) => rateLimit({
  windowMs,
  max,
  keyGenerator: (req) => {
    const suffix = paramName ? `:${req.params?.[paramName] || 'none'}` : '';
    return `${prefix}:${buildActorKey(req)}${suffix}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: message || 'Too many requests, please try again later.' },
});

module.exports = { buildActionLimiter, buildActorKey };