const bs58check = require('bs58check');
const bitcoin = require('bitgo-utxo-lib');
const { seedToPriv } = require('agama-wallet-lib/src/keys');

// TODO: merge spv and eth login/logout into a single function

module.exports = (api) => {
  api.setPost('/electrum/auth', (req, res, next) => {
    const _seed = req.body.seed;
    const isIguana = req.body.iguana;
    const _wifError = api.auth(_seed, isIguana);

    // api.log(JSON.stringify(api.electrumKeys, null, '\t'), true);

    const retObj = {
      msg: _wifError ? 'error' : 'success',
      result: 'true',
    };

    res.send(JSON.stringify(retObj));
  }, true);

  api.setGet("/electrum/check_auth", (req, res, next) => {
    try {
      res.send(
        JSON.stringify({
          msg: "success",
          result: api.seed != null,
        })
      );
    } catch (e) {
      res.send(
        JSON.stringify({
          msg: "error",
          result: e.message,
        })
      );
    }
  });
    
  api.auth = (seed, isIguana) => {
    let _wifError = false;

    if (!api.seed) {
      api.seed = seed;
    }

    seed = seedToPriv(seed, 'btc');

    // TODO: check seed only once
    for (let key in api.electrum.coinData) {
      if (key !== 'auth') {
        if (api.electrumKeys[key] != null) continue;
        
        const _seed = seed;
        let keys;
        let isWif = false;

        if (_seed.match('^[a-zA-Z0-9]{34}$') &&
            api.appConfig.general.main.experimentalFeatures) {
          api.log('watchonly pub addr');
          api.electrumKeys[key] = {
            priv: _seed,
            pub: _seed,
          };
          api._isWatchOnly = true;
        } else {
          api._isWatchOnly = false;

          try {
            bs58check.decode(_seed);
            isWif = true;
          } catch (e) {}

          if (isWif) {
            try {
              const _network = api.getNetworkData(key.toLowerCase());
              const _key = bitcoin.ECPair.fromWIF(_seed, _network, true);
              keys = {
                priv: _key.toWIF(),
                pub: _key.getAddress(),
                pubHex: _key.getPublicKeyBuffer().toString('hex'),
              };
            } catch (e) {
              api.log(e, 'api.auth');
              _wifError = true;
              break;
            }
          } else {
            keys = api.seedToWif(
              _seed,
              api.validateChainTicker(key),
              isIguana,
            );
          }

          api.electrumKeys[key] = {
            priv: keys.priv,
            pub: keys.pub,
            pubHex: keys.pubHex,
          };
        }
      }
    }

    api.electrum.auth = true;

    return _wifError;
  };

  api.setPost('/electrum/lock', (req, res, next) => {
    api.electrum.auth = false;
    api.electrumKeys = {};
    api.seed = null;
    api.eth.wallet = {};

    const retObj = {
      msg: 'success',
      result: 'true',
    };

    res.send(JSON.stringify(retObj));
  });

  api.setPost('/electrum/logout', (req, res, next) => {
    api.stopNSPVDaemon('all');
    
    api.seed = null;
    api.electrum = {
      ...api.electrum,
      auth: false,
      coinData: {}
    };
    api.electrumKeys = {};
    api.eth.coins = {};
    api.eth.connect = {};
    api.eth.wallet = {};

    api.eclManagerClear();

    const retObj = {
      msg: 'success',
      result: 'result',
    };

    res.send(JSON.stringify(retObj));
  });

  return api;
};
