"use strict";

const normalizeRpcPort = (value) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^[0-9]{1,5}$/.test(trimmed)) return null;
    value = Number(trimmed);
  }

  return Number.isInteger(value) && value >= 1 && value <= 65535
    ? value
    : null;
};

const readRpcPort = (configuration) => {
  if (typeof configuration !== "string") return Object.freeze({ found: false, port: null });
  let found = false;
  let port = null;
  for (const rawLine of configuration.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const match = line.match(/^rpcport\s*=\s*([^#;]*?)(?:\s*[#;].*)?$/i);
    if (!match) continue;
    found = true;
    port = normalizeRpcPort(match[1]);
  }
  return Object.freeze({ found, port });
};

module.exports = {
  normalizeRpcPort,
  readRpcPort,
};
