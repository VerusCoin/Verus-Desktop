// TODO: CLEANUP THIS FILE
const express = require('express');
let api = express.Router();
api.rpcCalls = {
  GET: {},
  POST: {}
}

api.coinsInitializing = {};
api.startedDaemonRegistry = {};
api.confFileIndex = {};
api.logFileIndex = {};
api.coindStdout = {};
api.guiLog = {};
api.rpcConf = {};
api.customKomodoNetworks = {};
api.appRuntimeLog = [];

api.plugins = api.plugins = {
  registry: {},
  builtin: {}
}
api.pluginWindows = {
  registry: {},
  builtin: {}
}
api.pluginOnCompletes = {
  registry: {},
  builtin: {}
}

api.lockDownAddCoin = false;
api._isWatchOnly = false;

// dex cache
api.mmupass = null;
api.mmRatesInterval = null;
api.mmPublic = {
  coins: [],
  mmupass: null,
  swaps: [],
  bids: [],
  asks: [],
  isAuth: false,
  rates: {},
  prices: [],
  coinsHelper: {},
  stats: [],
  electrumServersList: {},
};

// spv vars and libs
api.electrum = {
  auth: false,
  coinData: {},
};
api.electrumKeys = {};
api.electrumCache = {};

api.electrumJSCore = require('./electrumjs/electrumjs.core.js');
api.electrumJSNetworks = require('./electrumjs/electrumjs.networks.js');
const {
  electrumServers,
} = require('./electrumjs/electrumServers.js');
api.electrumServers = electrumServers;
api.electrumServersV1_4 = {};
api.nspvProcesses = {};
api.nspvPorts = {};
api.dpowCoins = require('agama-wallet-lib/src/electrum-servers-dpow');

api.CONNECTION_ERROR_OR_INCOMPLETE_DATA = 'connection error or incomplete data';

api.native = {
  startParams: {},
  launchConfigs: {},
  cache: {
    tx_cache: {},
    addr_balance_cache: {},
    currency_definition_cache: {},
  }
};

// eth
api.eth = {
  wallet: null,
  interface: null,
  temp: {
    pending_txs: {}
  }
};

// erc20
api.erc20 = {
  wallet: null,
  contracts: {}
}

api.setconf = require('../private/setconf.js');
api.nativeCoind = require('./nativeCoind.js');
api.nativeCoindList = {};
api.assetChainPorts = require('./ports.js');
api.assetChainPortsDefault = require('./ports.js');
api._appConfig = require('./appConfig.js');
api.chainParams = require('./chainParams');

// core
api = require('./api/paths.js')(api);
api = require('./api/auth.js')(api);

// core
api = require('./api/data_files/jsonFileManager')(api);
api = require('./api/log.js')(api);
api = require('./api/config.js')(api);
api = require('./api/users.js')(api);
api = require('./api/init.js')(api);
api = require('./api/plugin/registry')(api);
api = require('./api/plugin/install')(api);
api = require('./api/plugin/start')(api);
api = require('./api/plugin/stop')(api);
api = require('./api/plugin/builtin/authenticator')(api);
api = require('./api/plugin/builtin/loginconsentui')(api);
api = require('./api/plugin/builtin/pbaasvisualizer')(api);

api = require('./api/focus')(api);

// native
api = require('./api/native/addrBalance.js')(api);
api = require('./api/native/coins')(api);
api = require('./api/native/callDaemon')(api);
api = require('./api/native/addresses')(api);
api = require('./api/native/balances')(api);
api = require('./api/native/definedchains')(api);
api = require('./api/native/getBlock.js')(api);
api = require('./api/native/getVdxfId.js')(api);
api = require('./api/native/info')(api);
api = require('./api/native/mininginfo')(api);
api = require('./api/native/getTransaction.js')(api);
api = require('./api/native/transactions')(api);
api = require('./api/native/zoperations')(api);
api = require('./api/native/zgetencryptionaddress.js')(api);
api = require('./api/native/remove')(api);
api = require('./api/native/restart')(api);
api = require('./api/native/send.js')(api);
api = require('./api/native/sendcurrency.js')(api);
api = require('./api/native/reservetransfers.js')(api);
api = require('./api/native/nameRegistration.js')(api);
api = require('./api/native/idRegistration.js')(api);
api = require('./api/native/idRevocation.js')(api);
api = require('./api/native/idUpdate.js')(api);
api = require('./api/native/idInformation.js')(api);
api = require('./api/native/updateIdentity.js')(api);
api = require('./api/native/getCurrencies.js')(api);
api = require('./api/native/getCurrency.js')(api);
api = require('./api/native/estimateSendcurrencyFee.js')(api);
api = require('./api/native/estimateConversion.js')(api);
api = require('./api/native/getConversionPaths.js')(api);
api = require('./api/native/currencyGraylist.js')(api);
api = require('./api/native/idRecovery.js')(api);
api = require('./api/native/decryptdata.js')(api);
api = require('./api/native/signdata.js')(api);
api = require('./api/native/verifydata.js')(api);
api = require('./api/native/generate.js')(api);
api = require('./api/native/coinSupply.js')(api);
api = require('./api/native/blockSubsidy.js')(api);
api = require('./api/native/shieldcoinbase.js')(api);
api = require('./api/native/verusid/verusid.js')(api);
api = require('./api/native/credentials/getCredentials.js')(api);
api = require('./api/native/makeoffer')(api);
api = require('./api/native/getoffers')(api);
api = require('./api/native/closeoffers')(api);
api = require('./api/native/takeoffer')(api);
api = require('./api/native/setidentitytimelock')(api);
api = require('./api/native/exportwallet')(api);
api = require('./api/native/importwallet')(api);
api = require('./api/native/getNetworkGraph')(api);
api = require('./api/native/verusbridge/verusbridge.js')(api);
api = require('./api/native/verusbridge/vethconf.js')(api);

// lite 
api = require('./api/getSignatureInfo.js')(api);

// general network calls
api.networkFees = {}
api.coinSupply = {}
api = require('./api/network/fees/btc/btcFees')(api)
api = require('./api/network/fees/networkFees')(api)
api = require('./api/network/supply/vrsc/vrscCoinSupply')(api)
api = require('./api/network/supply/zec/zecCoinSupply')(api)
api = require('./api/network/supply/coinSupply')(api)

// core
api = require('./api/binsUtils.js')(api);
api = require('./api/downloadUtil.js')(api);
api = require('./api/pin.js')(api);
api = require('./api/downloadZcparams.js')(api);
api = require('./api/rpc.js')(api);
api = require('./api/confMaxconnections.js')(api);
api = require('./api/appInfo.js')(api);
api = require('./api/conf.js')(api);
api = require('./api/daemonControl.js')(api);
api = require('./api/system.js')(api);
api = require('./api/dlhandler.js')(api);

// Utility APIs
api = require('./api/utility_apis/csvExport.js')(api);
api = require('./api/utility_apis/pbaas')(api);
api = require('./api/utility_apis/checkUpdates')(api);
api = require('./api/utility_apis/cache')(api);

// kv
api = require('./api/kv.js')(api);

// spv
api = require('./api/electrum/network.js')(api);
api = require('./api/electrum/coins.js')(api);
api = require('./api/electrum/keys.js')(api);
api = require('./api/electrum/auth.js')(api);
api = require('./api/electrum/merkle.js')(api);
api = require('./api/electrum/balances.js')(api);
api = require('./api/electrum/info.js')(api);
api = require('./api/electrum/addresses.js')(api);
api = require('./api/electrum/transactions.js')(api);
api = require('./api/electrum/parseTxAddresses.js')(api);
api = require('./api/electrum/block.js')(api);
api = require('./api/electrum/interest.js')(api);
api = require('./api/electrum/listunspent.js')(api);
api = require('./api/electrum/cache.js')(api);
api = require('./api/electrum/proxy.js')(api);
api = require('./api/electrum/servers.js')(api);
api = require('./api/electrum/utils.js')(api);
api = require('./api/electrum/remove')(api);
api = require('./api/electrum/send.js')(api);
api = require('./api/electrum/connectionManager.js')(api);

api = require('./api/eth/auth.js')(api);
api = require('./api/eth/keys.js')(api);
api = require('./api/eth/balances.js')(api);
api = require('./api/eth/addresses')(api);
api = require('./api/eth/info')(api);
api = require('./api/eth/transactions.js')(api);
api = require('./api/eth/coins.js')(api);
api = require('./api/eth/send.js')(api);

api = require('./api/erc20/auth.js')(api);
api = require('./api/erc20/balances.js')(api);
api = require('./api/erc20/addresses')(api);
api = require('./api/erc20/info')(api);
api = require('./api/erc20/transactions.js')(api);
api = require('./api/erc20/coins.js')(api);
api = require('./api/erc20/send.js')(api);

// prices and price APIs
api = require('./api/fiat/prices')(api);

// Diagnostic and debugging info
api = require('./api/diagnostics.js')(api);

api = require('./api/construct')(api);

module.exports = api;