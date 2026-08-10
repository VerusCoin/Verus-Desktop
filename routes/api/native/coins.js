const { shell, dialog } = require('electron');
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const { VERUS_WIKI_WALLET_BACKUPS } = require("../utils/constants/urls");
const { normalizeRpcPort, readRpcPort } = require("../utils/rpcPort");
const {
  MAX_DAEMON_CONFIG_BYTES,
  daemonConfigurationSecurityDescriptor,
  effectiveStartupEnablesChainWriting,
  validateLaunchConfig,
  validateStartupOptions,
} = require("./security");

const STARTUP_AUTHORIZATION_ROUTES = new Set([
  "/native/coins/activate",
  "/native/coins/restart",
]);

module.exports = (api) => {
  const getChainValidationContext = (chainTicker) => {
    const ticker =
      typeof chainTicker === "string" ? chainTicker.toUpperCase() : "";
    const knownChain = ticker === "KMD" || api.chainParams[ticker] != null;

    return {
      knownChain,
      ticker,
    };
  };

  api.native.validateLaunchConfig = (
    chainTicker,
    launchConfig,
    startupOptions,
    shouldValidateStartupOptions = true
  ) => {
    const { knownChain, ticker } = getChainValidationContext(chainTicker);
    validateLaunchConfig(chainTicker, launchConfig);
    if (shouldValidateStartupOptions) {
      validateStartupOptions(startupOptions, chainTicker);
      validateStartupOptions(launchConfig.startupOptions, chainTicker);
    }

    if (knownChain) {
      const directoryName = ticker === "KMD" ? null : ticker === "VRSCTEST" ? "vrsctest" : ticker;
      const expectedDirectories = ticker === "KMD"
        ? { darwin: "Komodo", linux: "komodo", win32: "Komodo" }
        : {
            darwin: `Komodo/${directoryName}`,
            linux: `.komodo/${directoryName}`,
            win32: `Komodo/${directoryName}`,
          };
      const expectedDaemon = ticker === "VRSC" || ticker === "VRSCTEST"
        ? "verusd"
        : ticker === "PIRATE"
        ? "pirated"
        : "komodod";

      if (launchConfig.daemon !== expectedDaemon ||
          Object.keys(expectedDirectories).some(
            (platform) => launchConfig.dirNames[platform] !== expectedDirectories[platform]
          )) {
        throw new Error("Daemon binary or data directory does not match the selected chain");
      }
    } else {
      const chainOption = `-chain=${chainTicker.toLowerCase()}`;
      const launchOptions = Array.isArray(launchConfig.startupOptions)
        ? launchConfig.startupOptions
        : [];
      if (
        launchConfig.daemon !== "verusd" ||
        !launchConfig.confName ||
        (shouldValidateStartupOptions && !launchOptions.includes(chainOption))
      ) {
        throw new Error("Unsupported dynamic chain launch configuration");
      }
      const expectedDirectories = {
        darwin: `Verus/pbaas/${launchConfig.confName}`,
        linux: `.verus/pbaas/${launchConfig.confName}`,
        win32: `Verus/pbaas/${launchConfig.confName}`,
      };
      if (Object.keys(expectedDirectories).some(
        (platform) => launchConfig.dirNames[platform] !== expectedDirectories[platform]
      )) {
        throw new Error("Dynamic chain data directory does not match its configuration");
      }
    }
    return true;
  };

  const chainParamsToStartupOptions = (chainTicker) => {
    const options = [];
    const chainParams = api.chainParams[chainTicker] || {};
    for (const [key, rawValue] of Object.entries(chainParams)) {
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      for (const value of values) options.push(`-${key}=${value}`);
    }
    return options;
  };

  const resolveDaemonDataDirectory = (chainTicker, launchConfig) => {
    const configuredDataDirs =
      api.appConfig && api.appConfig.coin && api.appConfig.coin.native &&
      api.appConfig.coin.native.dataDir;
    const configuredDataDir = configuredDataDirs && configuredDataDirs[chainTicker];
    if (typeof configuredDataDir === "string" && configuredDataDir.length > 0) {
      return configuredDataDir;
    }

    const cachedDataDir = api.paths && api.paths[`${chainTicker.toLowerCase()}DataDir`];
    if (typeof cachedDataDir === "string" && cachedDataDir.length > 0) {
      return cachedDataDir;
    }

    const relativeDirectory = launchConfig.dirNames[process.platform];
    const homeDirectory =
      typeof global.HOME === "string" && global.HOME.length > 0
        ? global.HOME
        : process.env.HOME;
    if (typeof homeDirectory !== "string" || homeDirectory.length === 0) {
      throw new Error("Unable to resolve the daemon data directory safely");
    }
    if (global.USB_MODE || process.platform !== "darwin") {
      return path.resolve(homeDirectory, relativeDirectory);
    }
    return path.resolve(homeDirectory, "Library", "Application Support", relativeDirectory);
  };

  const readDaemonConfiguration = (configurationPath) => {
    try {
      const stat = fs.statSync(configurationPath);
      if (!stat.isFile()) {
        return { content: "", indeterminate: true, state: "not-a-file" };
      }
      if (stat.size > MAX_DAEMON_CONFIG_BYTES) {
        return { content: "", indeterminate: true, state: `oversized:${stat.size}` };
      }
      return {
        content: fs.readFileSync(configurationPath, "utf8"),
        indeterminate: false,
        state: "read",
      };
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return { content: "", indeterminate: false, state: "absent" };
      }
      return {
        content: "",
        indeterminate: true,
        state: `unreadable:${error && error.code ? error.code : "unknown"}`,
      };
    }
  };

  const fingerprintValues = (values) => {
    const fingerprint = createHash("sha256");
    for (const value of values) {
      fingerprint.update(String(value));
      fingerprint.update("\0");
    }
    return fingerprint.digest("hex");
  };

  api.native.captureStartupSecurityState = (
    chainTicker,
    launchConfig,
    startupOptions
  ) => {
    api.native.validateLaunchConfig(chainTicker, launchConfig, startupOptions);
    const commandLineOptions = [
      ...chainParamsToStartupOptions(chainTicker),
      ...validateStartupOptions(startupOptions, chainTicker),
      ...validateStartupOptions(launchConfig.startupOptions, chainTicker),
    ];
    const dataDirectory = resolveDaemonDataDirectory(chainTicker, launchConfig);
    const configurationPath = path.resolve(
      dataDirectory,
      `${launchConfig.confName == null ? chainTicker : launchConfig.confName}.conf`
    );
    const configuration = readDaemonConfiguration(configurationPath);
    let chainWriting = configuration.indeterminate;
    if (!chainWriting) {
      try {
        chainWriting = effectiveStartupEnablesChainWriting(
          commandLineOptions,
          configuration.content
        );
      } catch (error) {
        chainWriting = true;
      }
    }

    let configurationSecurityDescriptor;
    try {
      configurationSecurityDescriptor = daemonConfigurationSecurityDescriptor(
        configuration.content
      );
    } catch (error) {
      configurationSecurityDescriptor = "indeterminate";
    }
    return Object.freeze({
      chainWriting,
      configurationPath,
      configurationState: configuration.state,
      fingerprint: fingerprintValues([
        chainTicker,
        launchConfig.daemon,
        configurationPath,
        configuration.indeterminate,
        JSON.stringify(commandLineOptions),
        configurationSecurityDescriptor,
      ]),
    });
  };

  api.native.captureActivationSecurityState = async (
    chainTicker,
    launchConfig,
    startupOptions
  ) => {
    // Activation may only attach to a daemon whose RPC port is already in
    // use. In that branch the launch options are never evaluated by
    // startDaemon, so do only structural/chain validation before the port
    // check. A port that becomes free afterwards is handled fail-closed by
    // assertStartupAuthorization when the spawn-only option supplier runs.
    api.native.validateLaunchConfig(
      chainTicker,
      launchConfig,
      startupOptions,
      false
    );

    const dataDirectory = resolveDaemonDataDirectory(chainTicker, launchConfig);
    const configurationPath = path.resolve(
      dataDirectory,
      `${launchConfig.confName == null ? chainTicker : launchConfig.confName}.conf`
    );
    const configuration = readDaemonConfiguration(configurationPath);
    const configuredRpcPort = configuration.indeterminate
      ? { found: false, port: null }
      : readRpcPort(configuration.content);
    if (configuredRpcPort.found && configuredRpcPort.port == null) {
      throw new Error(`Invalid RPC port configured for ${chainTicker}`);
    }
    const candidatePort =
      configuredRpcPort.port ||
      normalizeRpcPort(api.assetChainPorts && api.assetChainPorts[chainTicker]) ||
      normalizeRpcPort(api.assetChainPortsDefault && api.assetChainPortsDefault[chainTicker]) ||
      normalizeRpcPort(launchConfig.fallbackPort);

    if (candidatePort != null && typeof api.checkPort === "function") {
      const portStatus = await api.checkPort(candidatePort);
      if (portStatus === "UNAVAILABLE") {
        let configurationSecurityDescriptor;
        try {
          configurationSecurityDescriptor = daemonConfigurationSecurityDescriptor(
            configuration.content
          );
        } catch (error) {
          configurationSecurityDescriptor = "indeterminate";
        }
        return Object.freeze({
          attachOnly: true,
          chainWriting: false,
          configurationPath,
          configurationState: configuration.state,
          fingerprint: fingerprintValues([
            "attach-existing-daemon",
            chainTicker,
            launchConfig.daemon,
            configurationPath,
            candidatePort,
            configurationSecurityDescriptor,
          ]),
        });
      }
    }

    return api.native.captureStartupSecurityState(
      chainTicker,
      launchConfig,
      startupOptions
    );
  };

  api.native.assertStartupAuthorization = (
    chainTicker,
    launchConfig,
    startupOptions,
    nativeAuthorizationContext
  ) => {
    const startupState = api.native.captureStartupSecurityState(
      chainTicker,
      launchConfig,
      startupOptions
    );
    if (!startupState.chainWriting) return startupState;
    if (
      typeof api.isIrreversibleAuthorizationEnabled === "function" &&
      api.isIrreversibleAuthorizationEnabled() === false
    ) {
      return startupState;
    }
    if (
      nativeAuthorizationContext == null ||
      nativeAuthorizationContext.status !== "approved" ||
      !STARTUP_AUTHORIZATION_ROUTES.has(nativeAuthorizationContext.actionId) ||
      nativeAuthorizationContext.startupFingerprint !== startupState.fingerprint
    ) {
      throw new Error(
        "Daemon chain-writing settings changed or were not authorized; the daemon was not started"
      );
    }
    return startupState;
  };

  api.ignoreNativeBackup = () => {
    const config = api.appConfig 
    
    api.saveLocalAppConf({
      ...config,
      general: {
        ...config.general,
        native: {
          ...config.general.native,
          remindNativeBackup: false,
        },
      },
    });
    api.appConfig = api.loadLocalConfig()
  }

  api.native.remindBackup = async () => {
    if (api.appConfig.general.native.remindNativeBackup) {
      const res = await dialog.showMessageBox(null, {
        type: "info",
        title: "Backup Your Wallet",
        message: "Native wallets are stored on a wallet file created in your computer. Make sure to backup your wallet file securely!",
        buttons: ["Show me how", "OK"],
      })
      
      api.ignoreNativeBackup()

      if (res.response === 0) {
        shell.openExternal(VERUS_WIKI_WALLET_BACKUPS)
      }
    }
  }

  api.native.activateNativeCoin = (
    coin,
    startupOptions = [],
    daemon,
    fallbackPort,
    dirNames,
    confName,
    tags = []
  ) => {
    let acOptions = [];
    const chainParams = api.chainParams[coin] || {};
    if (tags.includes("is_komodo"))
      api.customKomodoNetworks[coin.toLowerCase()] = true;

    for (let key in chainParams) {
      if (typeof chainParams[key] === "object") {
        for (let i = 0; i < chainParams[key].length; i++) {
          acOptions.push(`-${key}=${chainParams[key][i]}`);
        }
      } else {
        acOptions.push(`-${key}=${chainParams[key]}`);
      }
    }

    const getAcOptions = () => {
      const requestedOptions =
        typeof startupOptions === "function"
          ? startupOptions()
          : startupOptions;

      return acOptions.concat(requestedOptions == null ? [] : requestedOptions);
    };

    return new Promise((resolve, reject) => {
      api
        .startDaemon(coin, getAcOptions, daemon, dirNames, confName, fallbackPort)
        .then(() => {
          // Set timeout for "No running daemon message" to be
          // "Initializing daemon" for a few seconds
          api.coinsInitializing[coin] = true;

          setTimeout(() => {
            api.coinsInitializing[coin] = false;
          }, 40000);

          api.log(
            `${coin} daemon activation started successfully, waiting on daemon response...`,
            "native.confd"
          );

          resolve();
        })
        .catch((err) => {
          api.log(`${coin} failed to activate, error:`, "native.confd");
          api.log(err.message, "native.confd");

          reject(err);
        });
    });
  };

  api.native.addCoin = (
    chainTicker,
    launchConfig,
    startupOptions,
    nativeAuthorizationContext = null
  ) => {
    // Startup options are irrelevant when startDaemon attaches to an existing
    // process. Keep structural and chain-identity validation eager, but defer
    // option validation until startDaemon has decided it will spawn.
    api.native.validateLaunchConfig(
      chainTicker,
      launchConfig,
      startupOptions,
      false
    );
    let { daemon, fallbackPort, dirNames, confName, tags } = launchConfig;

    const getStartupParams = () => {
      // The option supplier may run after an approved HTTP request has timed
      // out or disconnected (restart deliberately schedules daemon startup).
      // Re-enter the shared execution guard before using that authorization.
      if (typeof api.assertProtectedActionExecutionActive === "function") {
        api.assertProtectedActionExecutionActive();
      }
      api.native.assertStartupAuthorization(
        chainTicker,
        launchConfig,
        startupOptions,
        nativeAuthorizationContext
      );
      api.native.validateLaunchConfig(
        chainTicker,
        launchConfig,
        startupOptions
      );
      let startupParams = [
        ...validateStartupOptions(startupOptions, chainTicker),
        ...validateStartupOptions(launchConfig.startupOptions, chainTicker),
      ];

      // TODO: Remove
      if (
        api.appConfig.coin.native.stakeGuard[chainTicker] &&
        api.appConfig.coin.native.stakeGuard[chainTicker].length > 0
      ) {
        startupParams.push(
          `-cheatcatcher=${api.appConfig.coin.native.stakeGuard[chainTicker]}`
        );
      }

      // This removes any duplicates in startupParams, keeping the last index
      startupParams = startupParams.filter((param, index) => {
        return (
          index == startupParams.length - 1 ||
          !startupParams.slice(index + 1).some((x) => {
            return x.split("=")[0] === param.split("=")[0];
          })
        );
      });

      return startupParams;
    };

    api.native.remindBackup()

    const returnResult = api.native.activateNativeCoin(
      chainTicker,
      getStartupParams,
      daemon,
      fallbackPort,
      dirNames,
      confName,
      tags
    );

    delete api.native.launchConfigs[chainTicker]
    api.native.launchConfigs[chainTicker] = launchConfig

    return returnResult
  };

  /**
   * Function to activate coin daemon in native mode
   */
  api.setPost("/native/coins/activate", async (req, res) => {
    const { chainTicker, launchConfig, startupOptions } = req.body;

    try {
      const result = await api.native.addCoin(
        chainTicker,
        launchConfig,
        startupOptions,
        req.native_authorization
      );

      return res.send(JSON.stringify({
        msg: "success",
        result,
      }));
    } catch (e) {
      return res.send(JSON.stringify({
        msg: "error",
        result: e.message,
      }));
    }
  }, true);

  return api;
};
