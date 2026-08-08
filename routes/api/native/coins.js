const { shell, dialog } = require('electron');
const { VERUS_WIKI_WALLET_BACKUPS } = require("../utils/constants/urls");
const {
  validateLaunchConfig,
  validateStartupOptions,
} = require("./security");

module.exports = (api) => {
  api.native.validateLaunchConfig = (chainTicker, launchConfig, startupOptions) => {
    validateLaunchConfig(chainTicker, launchConfig);
    validateStartupOptions(startupOptions);
    const ticker = chainTicker.toUpperCase();
    const knownChain = ticker === "KMD" || api.chainParams[ticker] != null;

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
      const launchOptions = launchConfig.startupOptions || [];
      if (launchConfig.daemon !== "verusd" || !launchOptions.includes(chainOption) || !launchConfig.confName) {
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
    const chainParams = api.chainParams[coin];
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

    acOptions = acOptions.concat(startupOptions);

    return new Promise((resolve, reject) => {
      api
        .startDaemon(coin, acOptions, daemon, dirNames, confName, fallbackPort)
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

  api.native.addCoin = (chainTicker, launchConfig, startupOptions) => {
    api.native.validateLaunchConfig(chainTicker, launchConfig, startupOptions);
    const validatedStartupOptions = validateStartupOptions(startupOptions);
    const validatedLaunchStartupOptions = validateStartupOptions(launchConfig.startupOptions);
    api.native.remindBackup()
    let { daemon, fallbackPort, dirNames, confName, tags } = launchConfig;

    let startupParams = [
      ...validatedStartupOptions,
      ...validatedLaunchStartupOptions,
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

    const returnResult = api.native.activateNativeCoin(
      chainTicker,
      startupParams,
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
  api.setPost("/native/coins/activate", (req, res) => {
    const { chainTicker, launchConfig, startupOptions } = req.body;

    api.native
      .addCoin(chainTicker, launchConfig, startupOptions)
      .then((result) => {
        const retObj = {
          msg: "success",
          result,
        };

        res.send(JSON.stringify(retObj));
      })
      .catch((e) => {
        const retObj = {
          msg: "error",
          result: e.message,
        };

        res.send(JSON.stringify(retObj));
      });
  }, true);

  return api;
};
