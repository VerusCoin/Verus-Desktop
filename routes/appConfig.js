const coinDataTranslated = require('./coinDataTranslated')
const zcashParamsSources = require('./zcashParamsSources')

let nonZCoins = {}
let nativeCoinStrings = {}
let nativeCoinBools = {}

const coinObjArray = coinDataTranslated.getSimpleCoinArray().map(simpleCoinObj => {
  const coinObj = coinDataTranslated.getCoinObj(simpleCoinObj.id)

  if (coinObj.tags.includes('is_zcash')) nonZCoins[coinObj.id] = false
  else nonZCoins[coinObj.id] = true

  if (coinObj.available_modes.native === true) {
    nativeCoinStrings[coinObj.id] = '',
    nativeCoinBools[coinObj.id] = false
  }

  return coinObj
})

const appConfig = {
  config: {
    display: {
      mining: {
        wallet: {
          openMiningBooklets: [{}],
          openStakingBooklets: [{}],
        }
      }
    },
    general: {
      main: {
        host: "127.0.0.1",
        agamaPort: 17775,
        maxDescriptors: {
          darwin: 90000,
          linux: 1000000
        },
        dev: false,
        cacheMbLimit: 30,
        livelog: false,
        uploadCrashReports: false,
        debug: false,
        roundValues: false,
        experimentalFeatures: false,
        dex: {
          walletUnlockTimeout: 3600
        },
        lang: "EN",
        fiatRates: true,
        fiatCurrency: "USD",
        requirePinToConfirmTx: false,
        defaultUserId: "",
        reservedChains: coinObjArray
          .map(coinObj => coinObj.id)
          .concat(["KOMODO", "pirated", "komodod"]),
        pbaasChains: [],
        pbaasTestmode: true,
        alwaysPromptUpdates: true,
        periodicallyCheckUpdates: true,
        encryptApiPost: true,
        enableDeeplink: false,
        agreedToTerms: false
      },
      electrum: {
        maxVinParseLimit: 120,
        cache: false,
        socketTimeout: 10000,
        customServers: false,
        maxTxListLength: 10,
        csvListtransactionsMaxLength: 400,
        syncServerListFromKv: false
      },
      native: {
        remindNativeBackup: true,
        passiveMode: false,
        rpc2cli: false,
        cliStopTimeout: 30000,
        failedRPCAttemptsThreshold: 10,
        stopNativeDaemonsOnQuit: true,
        dataDir: "",
        maxTxListLength: 10000,
        csvListtransactionsMaxLength: 1000,
        zcashParamsSrc: "verus.io",
        includeP2shAddrs: false,
        includeEmptyChangeAddrs: false,
        defaultShowEmptyAddrs: true,
        filterGenerateTransactions: true,
        showAddressCurrencyBalances: true
      }
    },
    coin: {
      native: {
        excludePrivateAddrs: nonZCoins,
        excludePrivateBalances: nonZCoins,
        excludePrivateTransactions: nonZCoins,
        excludePrivateAddressBalances: nonZCoins,
        stakeGuard: nativeCoinStrings,
        refundAddress: nativeCoinStrings,
        refundFromSource: nonZCoins,
        dataDir: nativeCoinStrings,
        noFastLoad: nativeCoinBools
      }
    },
    pubkey: "",
    exchanges: {
      coinswitchKey: ""
    }
  },
  schema: {
    general: {
      main: {
        host: {
          type: "text_input",
          displayName: "Hostname",
          info: "The application hostname.",
          hidden: true
        },
        agamaPort: {
          type: "number_input",
          displayName: "Verus Port",
          info:
            "The port that the Verus GUI will use to communicate with its back end."
        },
        cacheMbLimit: {
          type: "decimal_input",
          displayName: "Cache Size Limit (in Mb)",
          info:
            "Set the cache size limit (in megabytes). (Improves performance by storing blockchain data in local memory)"
        },
        dev: {
          type: "checkbox",
          displayName: "Dev Mode",
          info: "Run Verus in devmode, where it will search for a running GUI instead of using the pre-compiled one.",
          hidden: true
        },
        livelog: {
          type: "checkbox",
          displayName: "Live Logs",
          info: "Save app behaviour to a log file while the app is running.",
          hidden: true
        },
        uploadCrashReports: {
          type: "checkbox",
          displayName: "",
          info: "",
          hidden: true
        },
        pbaasTestmode: {
          type: "checkbox",
          displayName: "Verus Multiverse Testmode",
          info: "Changes Verus Multiverse capabilities to run in test mode. (Will work with only VRSCTEST)",
          hidden: true
        },
        alwaysPromptUpdates: {
          type: "checkbox",
          displayName: "Notify me about all app updates",
          info: "Enables update notifications for all updates, including non-mandatory."
        },
        periodicallyCheckUpdates: {
          type: "checkbox",
          displayName: "Periodically check for updates",
          info: "Sets Verus Desktop to periodically check for updates every 24 hours."
        },
        encryptApiPost: {
          hidden: true
        },
        enableDeeplink: {
          type: "checkbox",
          displayName: "Enable experimental VerusID login",
          info: "Enable logging in with VerusID through browser redirects. This is an experimental feature."
        },
      },
      electrum: {
        socketTimeout: {
          type: "number_input",
          displayName: "Socket Timeout",
          info: "The timeout for connections to electrum."
        },
        customServers: {
          type: "checkbox",
          displayName: "Custom electrum servers",
          info: "Use custom electrum servers."
        },
        maxTxListLength: {
          type: "number_input",
          displayName: "Max Transaction List Length",
          info: "The maximum number of transactions to fetch per call."
        }
      },
      native: {
        maxTxListLength: {
          type: "number_input",
          displayName: "Max Transaction List Length",
          info: "The maximum number of transactions to fetch per call."
        },
        passiveMode: {
          type: "checkbox",
          displayName: "Passive Mode",
          info: "Enabling passive mode greatly reduces the frequency of data fetch calls, and is best used for long term mining/staking wallets."
        },
        zcashParamsSrc: {
          type: "dropdown",
          options: Object.keys(zcashParamsSources),
          displayName: "ZCash Parameter Source",
          info: "The source for the initial ZCash parameter download."
        },
        includeP2shAddrs: {
          type: "checkbox",
          displayName: "Include Pay to Script Hash Addresses",
          info:
            "Include Pay to Script Hash addresses in your address list (ONLY SEND TO THESE IF YOU KNOW WHAT YOU ARE DOING)."
        },
        includeEmptyChangeAddrs: {
          type: "checkbox",
          displayName: "Include Empty Change Addresses",
          info:
            "Include automatically generated change addresses in your address list, even if they're empty."
        },
        defaultShowEmptyAddrs: {
          type: "checkbox",
          displayName: "Show Empty Addresses by Default",
          info: "Show empty addresses by default when viewing the address list."
        },
        filterGenerateTransactions: {
          type: 'checkbox',
          displayName: 'Separate Mining/Staking Transactions',
          info: 'Filter all mining/staking related transactions out of the main wallet tab, and only show them under the mining tab.',
        },
        showAddressCurrencyBalances: {
          type: 'checkbox',
          displayName: 'Show Currency Balances for Addresses',
          info: 'Show balances for every currency for each of your addresses. May impact performance on large wallets.',
        },
      }
    },
    coin: {
      native: {
        stakeGuard: {
          type: "text_input",
          displayName: "StakeGuard address",
          info:
            "Sapling address for Verus StakeGuard. (Will be used when Verus is started)"
        },
        noFastLoad: {
          type: "checkbox",
          displayName: "Memory optimization",
          info:
            "Reduce memory usage for this coin in native mode. May increase loading times on coin startup."
        },
        refundAddress: {
          type: "text_input",
          displayName: "Refund address",
          info: "Address where funds are refunded to if a transaction across a PBaaS gateway or for a currency pre-launch does not go through."
        },
        refundFromSource: {
          type: 'checkbox',
          displayName: 'Use source address for refunds when able',
          info: 'Sets the refund address to the address where funds were sent from if possible (will override refund address setting if able).',
        },
        dataDir: {
          type: "text_input",
          displayName: "Custom data directory",
          info: "A custom directory for coin data."
        }
      }
    }
  }
};

module.exports = appConfig;
