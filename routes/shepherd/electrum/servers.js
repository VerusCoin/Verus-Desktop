const fs = require('fs-extra');
const _fs = require('graceful-fs');
const fsnode = require('fs');
const deepmerge = require('../deepmerge');

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

module.exports = (shepherd) => {
  shepherd.mergeLocalKvElectrumServers = () => {
    if (shepherd.appConfig.general.electrum &&
        shepherd.appConfig.general.electrum.syncServerListFromKv) {
      try {
        let kvElectrumServersCache = fs.readFileSync(`${shepherd.agamaDir}/kvElectrumServersCache.json`, 'utf8');

        // temp edge cases until kv edit is implemented
        kvElectrumServersCache.replace('tpc', 'tcp');
        kvElectrumServersCache.replace('kraken.cryptap.us:50004:tcp', 'kraken.cryptap.us:50004:ssl');
        kvElectrumServersCache.replace('cetus.cryptap.us:50004:tcp', 'cetus.cryptap.us:50004:ssl');

        kvElectrumServersCache = JSON.parse(kvElectrumServersCache);

        if (Object.keys(kvElectrumServersCache).length) {
          for (let key in kvElectrumServersCache) {
            if (shepherd.electrumServers[key]) {
              if (!shepherd.electrumServers[key].serverList) {
                shepherd.electrumServers[key].serverList = kvElectrumServersCache[key];
              } else {
                for (let i = 0; i < kvElectrumServersCache[key].length; i++) {
                  if (!shepherd.electrumServers[key].serverList ||
                      !shepherd.electrumServers[key].serverList.find((item) => { return item === kvElectrumServersCache[key][i]; })) {
                    shepherd.electrumServers[key].serverList.push(kvElectrumServersCache[key][i]);
                  }
                }
              }

              // shepherd.electrumServers[key].abbr = key.toUpperCase();
              /*if (key === 'btcp') {
                console.log(shepherd.electrumServers[key]);
              }*/
            }
          }
        }
      } catch (e) {
        shepherd.log(e, true);
      }
    }
  };

  shepherd.loadElectrumServersList = () => {
    if (fs.existsSync(`${shepherd.agamaDir}/electrumServers.json`)) {
      const localElectrumServersList = fs.readFileSync(`${shepherd.agamaDir}/electrumServers.json`, 'utf8');

      shepherd.log('electrum servers list set from local file');

      try {
        shepherd.electrumServers = JSON.parse(localElectrumServersList);
        shepherd.mergeLocalKvElectrumServers();
      } catch (e) {
        shepherd.log(e, true);
      }
    } else {
      shepherd.log('local electrum servers list file is not found!');

      shepherd.saveElectrumServersList();
    }
  };

  shepherd.saveElectrumServersList = (list) => {
    const electrumServersListFileName = `${shepherd.agamaDir}/electrumServers.json`;

    if (!list) {
      list = shepherd.electrumServers;
    }

    _fs.access(shepherd.agamaDir, shepherd.fs.constants.R_OK, (err) => {
      if (!err) {
        const FixFilePermissions = () => {
          return new Promise((resolve, reject) => {
            const result = 'electrumServers.json file permissions updated to Read/Write';

            fsnode.chmodSync(electrumServersListFileName, '0600');

            setTimeout(() => {
              shepherd.log(result);
              resolve(result);
            }, 1000);
          });
        }

        const FsWrite = () => {
          return new Promise((resolve, reject) => {
            const result = 'electrumServers.json write file is done';

            fs.writeFile(electrumServersListFileName, JSON.stringify(list), 'utf8', (err) => {
              if (err)
                return shepherd.log(err);
            });

            fsnode.chmodSync(electrumServersListFileName, '0600');
            setTimeout(() => {
              shepherd.log(result);
              shepherd.log(`electrumServers.json file is created successfully at: ${shepherd.agamaDir}`);
              resolve(result);
            }, 2000);
          });
        }

        FsWrite()
        .then(FixFilePermissions());
      }
    });
  };

  shepherd.saveKvElectrumServersCache = (list) => {
    const kvElectrumServersListFileName = `${shepherd.agamaDir}/kvElectrumServersCache.json`;

    _fs.access(shepherd.agamaDir, shepherd.fs.constants.R_OK, (err) => {
      if (!err) {
        const FixFilePermissions = () => {
          return new Promise((resolve, reject) => {
            const result = 'kvElectrumServersCache.json file permissions updated to Read/Write';

            fsnode.chmodSync(kvElectrumServersListFileName, '0600');

            setTimeout(() => {
              shepherd.log(result);
              resolve(result);
            }, 1000);
          });
        }

        const FsWrite = () => {
          return new Promise((resolve, reject) => {
            const result = 'kvElectrumServersCache.json write file is done';

            fs.writeFile(kvElectrumServersListFileName, JSON.stringify(list), 'utf8', (err) => {
              if (err)
                return shepherd.log(err);
            });

            fsnode.chmodSync(kvElectrumServersListFileName, '0600');
            setTimeout(() => {
              shepherd.log(result);
              shepherd.log(`kvElectrumServersCache.json file is created successfully at: ${shepherd.agamaDir}`);
              resolve(result);
            }, 2000);
          });
        }

        FsWrite()
        .then(FixFilePermissions());
      }
    });
  };

  return shepherd;
};