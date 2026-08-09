const fs = require('fs-extra');
const {
  validateElectrumServerList,
  validateElectrumServersObject,
} = require("./serverValidation");
const { atomicWriteFileSync, validateJsonBuffer } = require("../utils/atomicFile");

// map coin names to tickers
const _ticker = {
  litecoin: 'ltc',
  bitcoin: 'btc',
  argentum: 'arg',
  komodo: 'kmd',
  monacoin: 'mona',
  crown: 'crw',
  faircoin: 'fair',
  namecoin: 'nmc',
  vertcoin: 'vtc',
  viacoin: 'via',
  dogecoin: 'doge',
  wc: 'xwc',
};

// TODO: add coins check, network, electrum params

module.exports = (api) => {
  api.mergeLocalKvElectrumServers = () => {
    if (api.appConfig.general.electrum &&
        api.appConfig.general.electrum.syncServerListFromKv) {
      try {
        let kvElectrumServersCache = fs.readFileSync(`${api.paths.agamaDir}/kvElectrumServersCache.json`, 'utf8');

        // temp edge cases until kv edit is implemented
        kvElectrumServersCache = kvElectrumServersCache.replace('tpc', 'tcp');
        kvElectrumServersCache = kvElectrumServersCache.replace('kraken.cryptap.us:50004:tcp', 'kraken.cryptap.us:50004:ssl');
        kvElectrumServersCache = kvElectrumServersCache.replace('cetus.cryptap.us:50004:tcp', 'cetus.cryptap.us:50004:ssl');

        kvElectrumServersCache = JSON.parse(kvElectrumServersCache);

        if (Object.keys(kvElectrumServersCache).length) {
          for (let key in kvElectrumServersCache) {
            if (api.electrumServers[key]) {
              const validatedServers = validateElectrumServerList(
                kvElectrumServersCache[key],
                { allowTcp: true }
              );
              if (!api.electrumServers[key].serverList) {
                api.electrumServers[key].serverList = validatedServers;
              } else {
                for (let i = 0; i < validatedServers.length; i++) {
                  if (!api.electrumServers[key].serverList ||
                      !api.electrumServers[key].serverList.find((item) => { return item === validatedServers[i]; })) {
                    api.electrumServers[key].serverList.push(validatedServers[i]);
                  }
                }
              }

              // api.electrumServers[key].abbr = key.toUpperCase();
              /*if (key === 'btcp') {
                console.log(api.electrumServers[key]);
              }*/
            }
          }
        }
      } catch (e) {
        api.log(e, 'spv.serverList');
      }
    }
  };

  api.loadElectrumServersList = () => {
    if (fs.existsSync(`${api.paths.agamaDir}/electrumServers.json`)) {
      const serverFile = `${api.paths.agamaDir}/electrumServers.json`;
      fs.chmodSync(serverFile, 0o600);
      const localElectrumServersList = fs.readFileSync(serverFile, 'utf8');

      try {
        api.electrumServers = validateElectrumServersObject(JSON.parse(localElectrumServersList));
        api.mergeLocalKvElectrumServers();
      } catch (e) {
        api.log(e, 'spv.serverList');
      }
    } else {
      api.saveElectrumServersList().catch((error) => {
        api.log(`Unable to create electrumServers.json: ${error.message}`, 'spv.serverList');
      });
    }
  };

  api.saveElectrumServersList = async (list) => {
    const electrumServersListFileName = `${api.paths.agamaDir}/electrumServers.json`;

    if (!list) {
      list = api.electrumServers;
    }

    const validated = validateElectrumServersObject(list);
    atomicWriteFileSync(electrumServersListFileName, JSON.stringify(validated), {
      backup: true,
      mode: 0o600,
      validate: validateJsonBuffer,
    });
    api.log('electrumServers.json write file is done', 'spv.serverList');
  };

  api.saveKvElectrumServersCache = async (list) => {
    const kvElectrumServersListFileName = `${api.paths.agamaDir}/kvElectrumServersCache.json`;

    if (!list || typeof list !== "object" || Array.isArray(list)) {
      throw new Error("Invalid Electrum KV server cache");
    }
    const validated = {};
    for (const [coin, servers] of Object.entries(list)) {
      if (!/^[0-9a-z._-]{1,64}$/i.test(coin)) throw new Error("Invalid Electrum coin ticker");
      validated[coin] = validateElectrumServerList(servers, { allowTcp: true });
    }
    atomicWriteFileSync(kvElectrumServersListFileName, JSON.stringify(validated), {
      backup: true,
      mode: 0o600,
      validate: validateJsonBuffer,
    });
    api.log('kvElectrumServersCache.json write file is done', 'spv.serverList');
  };

  return api;
};
