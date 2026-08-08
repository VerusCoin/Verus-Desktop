const path = require("path");

const PIN_FILE_NAME = /^[0-9a-zA-Z_-]+$/;
// Older releases allowed any number of ASCII filename characters. Keep every
// historically creatable name on conventional 255-byte-name filesystems while
// retaining a finite bound for request/path handling (`.pin` consumes 4).
const MAX_PIN_FILE_NAME_LENGTH = 251;
const MAX_BACKOFF_MS = 60 * 1000;
const ATTEMPT_RESET_MS = 10 * 60 * 1000;

const isValidPinFileName = (name) =>
  typeof name === "string" &&
  name.length > 0 &&
  name.length <= MAX_PIN_FILE_NAME_LENGTH &&
  PIN_FILE_NAME.test(name);

const resolvePinFile = (pinDirectory, name) => {
  if (!isValidPinFileName(name)) throw new Error("Invalid pin file name");

  const base = path.resolve(pinDirectory);
  const resolved = path.resolve(base, `${name}.pin`);
  if (!resolved.startsWith(`${base}${path.sep}`)) throw new Error("Invalid pin file path");
  return resolved;
};

const assertAttemptAllowed = (attempts, name, now = Date.now()) => {
  const attempt = attempts.get(name);
  if (!attempt) return;

  if (now - attempt.lastFailure > ATTEMPT_RESET_MS) {
    attempts.delete(name);
    return;
  }

  if (attempt.blockedUntil > now) {
    const retryAfterSeconds = Math.ceil((attempt.blockedUntil - now) / 1000);
    const error = new Error(`Too many failed attempts. Try again in ${retryAfterSeconds} seconds.`);
    error.code = "PIN_RATE_LIMITED";
    error.retryAfterSeconds = retryAfterSeconds;
    throw error;
  }
};

const recordFailedAttempt = (attempts, name, now = Date.now()) => {
  const previous = attempts.get(name);
  const failures = previous && now - previous.lastFailure <= ATTEMPT_RESET_MS
    ? previous.failures + 1
    : 1;
  const delay = Math.min(MAX_BACKOFF_MS, 1000 * Math.pow(2, failures - 1));

  attempts.set(name, {
    failures,
    lastFailure: now,
    blockedUntil: now + delay,
  });
};

module.exports = {
  assertAttemptAllowed,
  isValidPinFileName,
  recordFailedAttempt,
  resolvePinFile,
};
