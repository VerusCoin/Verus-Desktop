// TODO: Delete this file and find a way
// to use coinData in Verus-Desktop-GUI in appConfig.js

"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getSimpleCoinArray = exports.getCoinObj = void 0;

var _coinHelpers = _interopRequireDefault(
  require("agama-wallet-lib/src/coin-helpers")
);

var chainParams = require("./chainParams");

var _coins = _interopRequireDefault(require("../gui/Verus-Desktop-GUI/react/src/translate/coins"));

var _ethErc20ContractId = _interopRequireDefault(
  require("agama-wallet-lib/src/eth-erc20-contract-id")
);

var _electrumServers = _interopRequireDefault(
  require("agama-wallet-lib/src/electrum-servers")
);

var _bitcoinjsNetworks = _interopRequireDefault(
  require("agama-wallet-lib/src/bitcoinjs-networks")
);

var _utils = require("agama-wallet-lib/src/utils");

function _interopRequireDefault(obj) {
  return obj && obj.__esModule ? obj : { default: obj };
}

function _defineProperty(obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  } else {
    obj[key] = value;
  }
  return obj;
}

/**
 * Aggregates all relevant coin data needed in order to add
 * a coin to the wallet based on its chain ticker
 * @param {String} chainTicker Coin to add's chain ticker
 * @param {Boolean} isPbaas Whether or not the coin to add is a pbaas chain, will override unsupported coin check
 */
var getCoinObj = function getCoinObj(chainTicker) {
  var _available_modes;

  var isPbaas =
    arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;
  var allCoinNames = {
    ..._coins.default.BTC,
    ..._coins.default.ETH,
    ..._coins.default.ERC20
  };
  var chainTickerUc = chainTicker.toUpperCase();
  var chainTickerLc = chainTickerUc.toLowerCase();
  var tags = {};
  var coinObj = {
    id: chainTicker,
    options: {
      dustThreshold: 0.00001
    },
    isPbaasChain: isPbaas
  };
  var available_modes = ((_available_modes = {}),
  _defineProperty(_available_modes, 'native', false),
  _defineProperty(_available_modes, 'electrum', false),
  _defineProperty(_available_modes, 'eth', false),
  _available_modes); //If trying to add an unsupported chain, create a coin obj instead, dont use this function

  if (!isPbaas && !allCoinNames[chainTickerUc])
    throw new Error(
      "".concat(chainTicker, " not found in Verus coin list.")
    );
  else coinObj.name = allCoinNames[chainTickerUc];
  if (_coinHelpers.default.explorerList[chainTickerUc])
    coinObj.options.explorer = _coinHelpers.default.explorerList[chainTickerUc]; // Determine available modes based on available coin data and libraries

  if (_ethErc20ContractId.default[chainTickerUc]) {
    available_modes['erc20'] = true;
  } else if (chainTickerUc === "ETH") {
    available_modes['eth'] = true;
  } else {
    if (
      chainParams[chainTickerUc] ||
      chainTickerUc === "KMD"
    ) {
      available_modes['native'] = true;

      if (
        chainTickerUc !== "KMD" &&
        chainParams[chainTickerUc].ac_private
      ) {
        var _tags;

        tags = ((_tags = {
          ...tags
        }),
        _defineProperty(_tags, 'is_zcash', true),
        _defineProperty(_tags, 'is_sapling', true),
        _defineProperty(_tags, 'z_only', true),
        _tags);
      }

      if (
        _coinHelpers.default.isKomodoCoin &&
        chainTickerUc !== "VRSC" &&
        chainTickerUc !== "VRSCTEST"
      ) {
        coinObj.options.daemon = 'komodod'; // komodod
      } else {
        coinObj.options.daemon = 'verusd'; // verusd
      }
    }

    if (_electrumServers.default.electrumServers[chainTickerLc]) {
      available_modes['electrum'] = true;
    }

    if (_bitcoinjsNetworks.default[chainTickerLc]) {
      if (_bitcoinjsNetworks.default[chainTickerLc].isZcash)
        tags['is_zcash'] = true;

      if (_bitcoinjsNetworks.default[chainTickerLc].sapling) {
        tags['is_sapling'] = true;
        coinObj.options.saplingHeight =
          _bitcoinjsNetworks.default[chainTickerLc].saplingActivationHeight;
      }

      if (_bitcoinjsNetworks.default[chainTickerLc].dustThreshold)
        coinObj.options.dustThreshold = (0, _utils.fromSats)(
          _bitcoinjsNetworks.default[chainTickerLc].dustThreshold
        );
    } // Determine if chain is pbaas compatible, and if it is a pbaas root chain

    if (isPbaas || chainTickerUc === "VRSC") {
      var _tags2;

      tags = ((_tags2 = {
        ...tags
      }),
      _defineProperty(_tags2, 'is_zcash', true),
      _defineProperty(_tags2, 'is_pbaas', true),
      _defineProperty(_tags2, 'is_sapling', true),
      _tags2);
      available_modes['native'] = true;
      coinObj.options.daemon = 'verusd';
      if (chainTickerUc === "VRSCTEST")
        tags['is_pbaas_root'] = true;
    }
  }
  /* Final coin object structure, when it is dispatched to the store
    {
      id: 'VRSC',                                // Coin's chain ticker
      name: Verus,                               // Coin name
      tags: [                                    // Tags for coin to identify properties
        'is_sapling',
        'is_zcash',
        'is_pbaas',
        'is_pbaas_root'],
      available_modes: {                         // Modes in which this coin can be activated
        'native': true,
        'electrum': true,
        'eth': false
      },
      options: {
        explorer: https://explorer.verus.io, // (Optional) Explorer URL.
        saplingHeight: 10000,                    // (Optional) height at which sapling will be activated for the chain
        dustThreshold: 0.00001,                  // (Optional) Network threshold for dust values
        daemon: 'verusd',                        // (Optional) Specify a custom daemon for native mode
        startupOptions: ['-mint']                // (Optional) Added in a later step, native options for daemon start
      },
      isPbaasChain: false,                       // Boolean to decide whether or not to skip coin compatability check
      themeColor: hexCode                        // Theme color for coin to add, added to coin object in addCoin asynchronously
    }
  */

  return {
    ...coinObj,
    tags: Object.keys(tags),
    available_modes: available_modes
  };
};

exports.getCoinObj = getCoinObj;

var getSimpleCoinArray = function getSimpleCoinArray() {
  var _coinArr;

  var coinArr = [];

  for (var protocol in _coins.default) {
    for (var coin in _coins.default[protocol]) {
      coinArr.push({
        id: coin,
        name: _coins.default[protocol][coin],
        protocol: protocol
      });
    }
  } // Put VRSC, KMD and BTC at the top, else sort alphabetically

  var topThree = [];

  for (var i = 0; i < 3; i++) {
    topThree.push(coinArr.shift());
  }

  coinArr = coinArr.sort(function(a, b) {
    var x = a.name.toLowerCase();
    var y = b.name.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });

  (_coinArr = coinArr).unshift.apply(_coinArr, topThree);

  return coinArr;
};

exports.getSimpleCoinArray = getSimpleCoinArray;
