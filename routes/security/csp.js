"use strict";

const buildContentSecurityPolicy = (port) => {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError("A valid renderer API port is required for CSP");
  }
  const backendHttp = `http://127.0.0.1:${port}`;
  const backendSocket = `ws://127.0.0.1:${port}`;
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${backendHttp} ${backendSocket}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "media-src 'none'",
    "manifest-src 'self'",
  ].join("; ");
};

const createContentSecurityPolicyMiddleware = (port, enabled = true) => {
  const policy = buildContentSecurityPolicy(port);
  return (req, res, next) => {
    if (enabled) res.setHeader("Content-Security-Policy", policy);
    next();
  };
};

module.exports = {
  buildContentSecurityPolicy,
  createContentSecurityPolicyMiddleware,
};
