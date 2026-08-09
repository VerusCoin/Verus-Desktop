const net = require("net");

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const DEV_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

const parseHostHeader = (hostHeader) => {
  if (typeof hostHeader !== "string" || hostHeader.length === 0) return null;

  try {
    const parsed = new URL(`http://${hostHeader}`);
    return {
      hostname: parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase(),
      port: parsed.port,
    };
  } catch (e) {
    return null;
  }
};

const isAllowedHostHeader = (hostHeader, expectedPort) => {
  if (typeof hostHeader !== "string") return false;
  const normalized = hostHeader.toLowerCase();
  const port = String(expectedPort);

  return normalized === `127.0.0.1:${port}` ||
    normalized === `localhost:${port}` ||
    normalized === `[::1]:${port}`;
};

const createHostValidationMiddleware = (expectedPort) => (req, res, next) => {
  if (!isAllowedHostHeader(req.headers.host, expectedPort)) {
    return res.status(403).json({ error: "Invalid Host header" });
  }

  return next();
};

const requireJsonPost = (req, res, next) => {
  if (req.method === "POST" && !req.is("application/json")) {
    return res.status(415).json({ error: "Content-Type must be application/json" });
  }

  return next();
};

const isAllowedSocketOrigin = (origin, expectedPort, isDevMode) => {
  if (typeof origin !== "string") return false;
  if (isDevMode) return DEV_ORIGINS.has(origin);
  return origin === `http://127.0.0.1:${expectedPort}`;
};

const createDevCorsMiddleware = (enabled) => {
  return (req, res, next) => {
    if (!enabled) return next();

    const origin = req.headers.origin;
    if (origin && DEV_ORIGINS.has(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Vary", "Origin");
      res.header("Access-Control-Allow-Headers", "X-Requested-With, Content-Type");
      res.header("Access-Control-Allow-Credentials", "true");
      res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }

    if (req.method === "OPTIONS") return res.sendStatus(204);
    return next();
  };
};

const isLoopbackAddress = (address) => {
  if (typeof address !== "string") return false;
  const normalized = address.replace(/^::ffff:/, "");
  return normalized === "127.0.0.1" ||
    normalized === "::1" ||
    (net.isIP(normalized) === 0 && normalized === "localhost");
};

module.exports = {
  createDevCorsMiddleware,
  createHostValidationMiddleware,
  isAllowedHostHeader,
  isAllowedSocketOrigin,
  isLoopbackAddress,
  parseHostHeader,
  requireJsonPost,
};
