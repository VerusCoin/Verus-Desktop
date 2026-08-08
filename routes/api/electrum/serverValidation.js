const net = require("net");

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

const parseElectrumServer = (server) => {
  if (typeof server !== "string" || server.length > 320) {
    throw new Error("Invalid Electrum server entry");
  }

  const parts = server.split(":");
  if (parts.length !== 3) throw new Error(`Invalid Electrum server entry: ${server}`);
  const [host, portString, protocol] = parts;
  const port = Number(portString);

  if ((!HOSTNAME.test(host) && net.isIP(host) !== 4) ||
      !Number.isInteger(port) || port < 1 || port > 65535 ||
      (protocol !== "ssl" && protocol !== "tcp")) {
    throw new Error(`Invalid Electrum server entry: ${server}`);
  }

  return { host: host.toLowerCase(), port, protocol };
};

const validateElectrumServerList = (servers, options = {}) => {
  const { allowTcp = false, filterTcp = false } = options;
  if (!Array.isArray(servers) || servers.length === 0 || servers.length > 32) {
    throw new Error("Electrum server list must contain between 1 and 32 entries");
  }

  const validated = [];
  for (const server of servers) {
    const parsed = parseElectrumServer(server);
    if (parsed.protocol === "tcp" && !allowTcp) {
      if (filterTcp) continue;
      throw new Error(`Insecure Electrum TCP server is not allowed: ${server}`);
    }
    const normalized = `${parsed.host}:${parsed.port}:${parsed.protocol}`;
    if (!validated.includes(normalized)) validated.push(normalized);
  }

  if (validated.length === 0) {
    throw new Error("No secure Electrum SSL servers are available for this coin. Enabling insecure electrum TCP can be done in settings -> general settings -> electrum.");
  }
  return validated;
};

const validateElectrumServersObject = (serverObject) => {
  if (!serverObject || typeof serverObject !== "object" || Array.isArray(serverObject)) {
    throw new Error("Invalid Electrum servers file");
  }

  const validated = {};
  for (const [coin, config] of Object.entries(serverObject)) {
    if (["__proto__", "constructor", "prototype"].includes(coin) ||
        !/^[0-9a-z._-]{1,64}$/i.test(coin) ||
        !config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error(`Invalid Electrum configuration for ${coin}`);
    }
    if (config.txfee != null && (!Number.isFinite(Number(config.txfee)) || Number(config.txfee) < 0)) {
      throw new Error(`Invalid Electrum fee for ${coin}`);
    }

    validated[coin.toLowerCase()] = { txfee: config.txfee == null ? 0 : Number(config.txfee) };
    if (config.serverList != null) {
      validated[coin.toLowerCase()].serverList = validateElectrumServerList(
        config.serverList,
        { allowTcp: true }
      );
    }
  }
  return validated;
};

module.exports = {
  parseElectrumServer,
  validateElectrumServerList,
  validateElectrumServersObject,
};
