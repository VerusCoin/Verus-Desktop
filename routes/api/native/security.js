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
// Desktop starts daemons with execFile and an argv array, so ordinary option
// values are not interpreted by a shell. These are the command hooks currently
// passed to runCommand/system() by every bundled native daemon.
const COMMAND_STARTUP_OPTION_NAMES = new Set([
  "alertnotify",
  "blocknotify",
  "walletnotify",
]);
// These can load the command hooks above from a different configuration file.
const CONFIG_SELECTOR_STARTUP_OPTION_NAMES = new Set([
  "conf",
  "datadir",
  "notarydatadir",
]);
// Desktop must own these values so RPC security, port detection, and the
// selected chain still describe the process it launches. Matching chain/ac_name
// values are allowed.
const DESKTOP_MANAGED_STARTUP_OPTION_NAMES = new Set([
  "ac_name",
  "chain",
  "rpcallowip",
  "rpcauth",
  "rpcbind",
  "rpcpassword",
  "rpcport",
  "rpcuser",
]);
const DENIED_STARTUP_OPTION_NAMES = new Set([
  ...COMMAND_STARTUP_OPTION_NAMES,
  ...CONFIG_SELECTOR_STARTUP_OPTION_NAMES,
  ...DESKTOP_MANAGED_STARTUP_OPTION_NAMES,
]);
const MATCHING_CHAIN_OPTION_NAMES = new Set(["ac_name", "chain"]);
const MAX_STARTUP_OPTIONS = 256;
const MAX_STARTUP_OPTIONS_BYTES = 12 * 1024;

const isValidChainTicker = (value) =>
  typeof value === "string" && CHAIN_TICKER.test(value);

const isSafeRelativeDirectory = (value) => {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return false;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false;

  const segments = value.split(/[\\/]+/);
  return segments.every((segment) => segment && segment !== "." && segment !== "..");
};

const parseStartupOption = (option) => {
  if (
    typeof option !== "string" ||
    option.length === 0 ||
    /[\u0000-\u001f\u007f-\u009f]/.test(option)
  ) {
    return null;
  }

  const separatorIndex = option.indexOf("=");
  let normalizedName =
    separatorIndex === -1 ? option : option.slice(0, separatorIndex);

  // Mirror ParseParameters: Windows first changes /foo to -foo, then all
  // platforms change --foo to -foo. Applying both transformations also covers
  // the Windows-only /-foo alias.
  if (normalizedName.startsWith("/") && process.platform !== "win32") {
    return null;
  }
  if (normalizedName.startsWith("/")) {
    normalizedName = `-${normalizedName.slice(1)}`;
  }
  if (!normalizedName.startsWith("-")) return null;
  if (normalizedName.length > 1 && normalizedName[1] === "-") {
    normalizedName = normalizedName.slice(1);
  }

  const name = normalizedName.slice(1);
  if (name.length === 0 || /\s/.test(name)) return null;

  return {
    name: name.toLowerCase(),
    value: separatorIndex === -1 ? undefined : option.slice(separatorIndex + 1),
  };
};

const startupOptionNameMatches = (name, expectedName) => {
  let candidate = name;

  // Bitcoin-style negative settings turn -nofoo into -foo=0/1. Repeated
  // prefixes can cascade while the daemon iterates its ordered option map.
  while (candidate) {
    if (candidate === expectedName) return true;
    if (!candidate.startsWith("no") || candidate.length <= 2) return false;
    candidate = candidate.slice(2);
  }

  return false;
};

const isDeniedStartupOptionName = (name) =>
  Array.from(DENIED_STARTUP_OPTION_NAMES).some((deniedName) =>
    startupOptionNameMatches(name, deniedName)
  );

const isAllowedStartupOption = (option, allowedChainTicker = null) => {
  const parsed = parseStartupOption(option);
  if (parsed == null) return false;

  if (
    MATCHING_CHAIN_OPTION_NAMES.has(parsed.name) &&
    typeof allowedChainTicker === "string" &&
    typeof parsed.value === "string" &&
    parsed.value.toLowerCase() === allowedChainTicker.toLowerCase()
  ) {
    return true;
  }

  return !isDeniedStartupOptionName(parsed.name);
};

const validateStartupOptions = (options, allowedChainTicker = null) => {
  if (options == null) return [];
  if (!Array.isArray(options)) throw new Error("Daemon startup options must be an array");
  if (options.length > MAX_STARTUP_OPTIONS) {
    throw new Error("Too many daemon startup options");
  }

  let totalBytes = 0;

  for (const option of options) {
    if (!isAllowedStartupOption(option, allowedChainTicker)) {
      throw new Error(`Daemon startup option is not allowed: ${String(option)}`);
    }
    totalBytes += Buffer.byteLength(option, "utf8");
    if (totalBytes > MAX_STARTUP_OPTIONS_BYTES) {
      throw new Error("Daemon startup options are too large");
    }
  }

  return options.slice();
};

const hasStartupOption = (options, optionName) => {
  const normalizedName = String(optionName).replace(/^-+/, "").toLowerCase();

  return (
    Array.isArray(options) &&
    options.some((option) => {
      const parsed = parseStartupOption(option);
      return (
        parsed != null &&
        startupOptionNameMatches(parsed.name, normalizedName)
      );
    })
  );
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
  hasStartupOption,
  isAllowedStartupOption,
  isAllowedRpcMethod,
  isSafeWalletImportPath,
  isSafeRelativeDirectory,
  isSafeWalletFilename,
  isValidChainTicker,
  validateLaunchConfig,
  validateStartupOptions,
};
