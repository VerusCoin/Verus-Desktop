const path = require("path");
const { DAEMON_NAMES } = require("../utils/constants");

const CHAIN_TICKER = /^[0-9a-zA-Z._-]{1,64}$/;
const READ_ONLY_RPC_METHODS = new Set([
  "coinsupply",
  "decoderawtransaction",
  "estimateconversion",
  "estimatefee",
  "estimatesmartfee",
  "getaddressbalance",
  "getaddressdeltas",
  "getaddressesbyaccount",
  "getaddressmempool",
  "getaddresstxids",
  "getaddressutxos",
  "getbestblockhash",
  "getblock",
  "getblockchaininfo",
  "getblockcount",
  "getblockhash",
  "getblockheader",
  "getblocksubsidy",
  "getconnectioncount",
  "getcurrencies",
  "getcurrency",
  "getcurrencybalance",
  "getdefinedchains",
  "getidentity",
  "getinfo",
  "getmempoolinfo",
  "getmininginfo",
  "getnetworkinfo",
  "getpeerinfo",
  "getrawmempool",
  "getrawtransaction",
  "gettransaction",
  "gettxout",
  "gettxoutsetinfo",
  "getvdxfid",
  "getwalletinfo",
  "help",
  "listaddressgroupings",
  "listcurrencies",
  "listidentities",
  "listopenoffers",
  "listreceivedbyaddress",
  "listtransactions",
  "listunspent",
  "validateaddress",
  "verifychain",
  "verifymessage",
  "z_getbalance",
  "z_getoperationresult",
  "z_getoperationstatus",
  "z_gettotalbalance",
  "z_listaddresses",
  "z_listunspent",
  "z_validateaddress",
  "z_viewtransaction",
]);
const SIMPLE_STARTUP_OPTIONS = new Set([
  "-bootstrap",
  "-fastload",
  "-gen",
  "-mint",
  "-nspv",
  "-reindex",
  "-rescan",
  "-zapwallettxes",
]);

const isValidChainTicker = (value) =>
  typeof value === "string" && CHAIN_TICKER.test(value);

const isSafeRelativeDirectory = (value) => {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return false;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false;

  const segments = value.split(/[\\/]+/);
  return segments.every((segment) => segment && segment !== "." && segment !== "..");
};

const isAllowedStartupOption = (option) => {
  if (typeof option !== "string" || option.length > 512) return false;
  if (SIMPLE_STARTUP_OPTIONS.has(option)) return true;
  if (/^-zapwallettxes=[12]$/.test(option)) return true;
  if (/^-genproclimit=(-1|[0-9]{1,4})$/.test(option)) return true;
  if (/^-maxconnections=[0-9]{1,5}$/.test(option)) return Number(option.split("=")[1]) <= 10000;
  if (/^-pubkey=[0-9a-fA-F]{66}$/.test(option)) return true;
  if (/^-chain=[0-9a-zA-Z._-]{1,64}$/.test(option)) return true;

  return false;
};

const validateStartupOptions = (options) => {
  if (options == null) return [];
  if (!Array.isArray(options)) throw new Error("Daemon startup options must be an array");
  if (options.length > 32) throw new Error("Too many daemon startup options");

  for (const option of options) {
    if (!isAllowedStartupOption(option)) {
      throw new Error(`Daemon startup option is not allowed: ${String(option)}`);
    }
  }

  return options.slice();
};

const validateLaunchConfig = (chainTicker, launchConfig) => {
  if (!isValidChainTicker(chainTicker)) {
    throw new Error("Invalid chain ticker");
  }
  if (!launchConfig || typeof launchConfig !== "object" || Array.isArray(launchConfig)) {
    throw new Error("Invalid daemon launch configuration");
  }
  if (!DAEMON_NAMES.includes(launchConfig.daemon)) {
    throw new Error("Invalid daemon name");
  }
  if (!launchConfig.dirNames || typeof launchConfig.dirNames !== "object") {
    throw new Error("Invalid daemon data directories");
  }
  for (const platform of ["darwin", "linux", "win32"]) {
    if (!isSafeRelativeDirectory(launchConfig.dirNames[platform])) {
      throw new Error(`Invalid ${platform} daemon data directory`);
    }
  }
  if (launchConfig.fallbackPort != null &&
      (!Number.isInteger(launchConfig.fallbackPort) ||
       launchConfig.fallbackPort < 1 ||
       launchConfig.fallbackPort > 65535)) {
    throw new Error("Invalid daemon fallback port");
  }
  if (launchConfig.confName != null &&
      (typeof launchConfig.confName !== "string" ||
       !/^[0-9a-zA-Z._-]{1,128}$/.test(launchConfig.confName))) {
    throw new Error("Invalid daemon configuration filename");
  }
  if (launchConfig.tags != null &&
      (!Array.isArray(launchConfig.tags) ||
       launchConfig.tags.some((tag) => typeof tag !== "string" || !/^[0-9a-z_-]{1,64}$/i.test(tag)))) {
    throw new Error("Invalid daemon tags");
  }

  validateStartupOptions(launchConfig.startupOptions);
  return true;
};

const isAllowedRpcMethod = (method) =>
  typeof method === "string" && method === method.toLowerCase() && READ_ONLY_RPC_METHODS.has(method);

const isSafeWalletFilename = (filename) =>
  typeof filename === "string" &&
  filename.length > 0 &&
  filename.length <= 255 &&
  filename !== "." &&
  filename !== ".." &&
  path.posix.basename(filename) === filename &&
  path.win32.basename(filename) === filename &&
  /^[0-9a-zA-Z._ -]+$/.test(filename);

const isSafeWalletImportPath = (filename) =>
  typeof filename === "string" &&
  filename.length > 0 &&
  filename.length <= 4096 &&
  !/[\0\r\n]/.test(filename) &&
  (path.posix.isAbsolute(filename) || path.win32.isAbsolute(filename));

module.exports = {
  isAllowedStartupOption,
  isAllowedRpcMethod,
  isSafeWalletImportPath,
  isSafeRelativeDirectory,
  isSafeWalletFilename,
  isValidChainTicker,
  validateLaunchConfig,
  validateStartupOptions,
};
