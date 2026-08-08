const path = require("path");

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_STRING_LENGTH = 16 * 1024;
const MAX_ARRAY_LENGTH = 10000;
const DYNAMIC_COIN_MAP_TYPES = new Map([
  ["config.coin.native.excludePrivateAddrs", "boolean"],
  ["config.coin.native.excludePrivateBalances", "boolean"],
  ["config.coin.native.excludePrivateTransactions", "boolean"],
  ["config.coin.native.excludePrivateAddressBalances", "boolean"],
  ["config.coin.native.stakeGuard", "string"],
  ["config.coin.native.refundAddress", "string"],
  ["config.coin.native.refundFromSource", "boolean"],
  ["config.coin.native.dataDir", "string"],
  ["config.coin.native.noFastLoad", "boolean"],
]);

const isValidDynamicCoinKey = (key) =>
  typeof key === "string" &&
  key.length > 0 &&
  key.length <= 128 &&
  key.trim() === key &&
  !FORBIDDEN_KEYS.has(key) &&
  !/[\\/:*?"<>|@\u0000-\u001f]/.test(key);

const normalizeDynamicCoinValue = (value, expectedType, location) => {
  if (typeof value !== expectedType) {
    throw new Error(`${location} must be a ${expectedType}`);
  }
  if (expectedType === "string" && value.length > MAX_STRING_LENGTH) {
    throw new Error(`${location} is too long`);
  }
  return value;
};

const isPlainObject = (value) => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const sanitizeDynamicJson = (value, location, depth = 0) => {
  if (depth > 20) throw new Error(`${location} exceeds the maximum nesting depth`);
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${location} must contain finite numbers`);
    return value;
  }
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) throw new Error(`${location} contains an oversized string`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) throw new Error(`${location} contains too many items`);
    return value.map((item, index) => sanitizeDynamicJson(item, `${location}[${index}]`, depth + 1));
  }
  if (!isPlainObject(value)) throw new Error(`${location} contains an unsupported value`);

  const output = {};
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`${location} contains a forbidden key`);
    output[key] = sanitizeDynamicJson(value[key], `${location}.${key}`, depth + 1);
  }
  return output;
};

const normalizeAgainstTemplate = (
  value,
  template,
  location = "config",
  options = {}
) => {
  if (Array.isArray(template)) {
    if (!Array.isArray(value)) throw new Error(`${location} must be an array`);
    if (value.length > MAX_ARRAY_LENGTH) throw new Error(`${location} contains too many items`);

    if (template.length && template.every((item) => typeof item === "string")) {
      if (value.some((item) => typeof item !== "string" || item.length > MAX_STRING_LENGTH)) {
        throw new Error(`${location} must contain strings`);
      }
      return value.slice();
    }

    return value.map((item, index) => sanitizeDynamicJson(item, `${location}[${index}]`));
  }

  if (isPlainObject(template)) {
    if (!isPlainObject(value)) throw new Error(`${location} must be an object`);
    const allowedKeys = new Set(Object.keys(template));
    const dynamicValueType = DYNAMIC_COIN_MAP_TYPES.get(location);
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) {
        throw new Error(`${location}.${key} is not a recognized configuration property`);
      }
      if (!allowedKeys.has(key)) {
        if (dynamicValueType) {
          if (!isValidDynamicCoinKey(key)) {
            throw new Error(`${location}.${key} is not a valid chain entry`);
          }
          normalizeDynamicCoinValue(value[key], dynamicValueType, `${location}.${key}`);
        } else if (options.stripUnknown !== true) {
          throw new Error(`${location}.${key} is not a recognized configuration property`);
        }
      }
    }

    const output = {};
    for (const key of Object.keys(template)) {
      const nextValue = Object.prototype.hasOwnProperty.call(value, key) ? value[key] : template[key];
      output[key] = normalizeAgainstTemplate(
        nextValue,
        template[key],
        `${location}.${key}`,
        options
      );
    }
    if (dynamicValueType) {
      for (const key of Object.keys(value)) {
        if (!allowedKeys.has(key)) {
          output[key] = normalizeDynamicCoinValue(
            value[key],
            dynamicValueType,
            `${location}.${key}`
          );
        }
      }
    }
    return output;
  }

  if (typeof value !== typeof template || value == null) {
    throw new Error(`${location} must be a ${typeof template}`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`${location} must be finite`);
  }
  if (typeof value === "string" && value.length > MAX_STRING_LENGTH) {
    throw new Error(`${location} is too long`);
  }
  return value;
};

const validateSecuritySensitiveValues = (config) => {
  const { main, electrum } = config.general;
  if (main.host !== "127.0.0.1") throw new Error("config.general.main.host must be 127.0.0.1");
  if (!Number.isInteger(main.agamaPort) || main.agamaPort < 1024 || main.agamaPort > 65535) {
    throw new Error("config.general.main.agamaPort must be an integer from 1024 through 65535");
  }
  if (main.encryptApiPost !== true) {
    throw new Error("config.general.main.encryptApiPost cannot be disabled");
  }
  if (main.dev !== false) {
    throw new Error("config.general.main.dev can only be enabled with the devmode command-line option");
  }
  if (!Number.isInteger(electrum.socketTimeout) || electrum.socketTimeout < 1000 || electrum.socketTimeout > 120000) {
    throw new Error("config.general.electrum.socketTimeout must be an integer from 1000 through 120000");
  }

  for (const [coin, address] of Object.entries(config.coin.native.stakeGuard)) {
    if (typeof address !== "string" || !/^[0-9a-zA-Z]{0,256}$/.test(address)) {
      throw new Error(`config.coin.native.stakeGuard.${coin} is not a valid address`);
    }
  }

  const dataDirectories = [
    config.general.native.dataDir,
    ...Object.values(config.coin.native.dataDir),
  ];
  for (const dataDirectory of dataDirectories) {
    if (dataDirectory !== "" &&
        (typeof dataDirectory !== "string" ||
         (!path.posix.isAbsolute(dataDirectory) && !path.win32.isAbsolute(dataDirectory)) ||
         /[\0\r\n]/.test(dataDirectory))) {
      throw new Error("Custom daemon data directories must be absolute paths");
    }
  }
};

const normalizeConfig = (candidate, template, options = {}) => {
  const normalized = normalizeAgainstTemplate(candidate, template, "config", options);
  validateSecuritySensitiveValues(normalized);
  return normalized;
};

module.exports = {
  isPlainObject,
  normalizeConfig,
};
