const portscanner = require('portscanner');

module.exports = (api) => {
  api.quitDaemon = (key, timeout) => {
    let coindPingInterval = {};
    let coindStopInterval = {};

    return new Promise((resolve, reject) => {
      const chain = key !== 'komodod' ? key : null;
  
      const execCliStop = () => {
        let _arg = [];
  
        if (chain &&
            !api.nativeCoindList[key.toLowerCase()]) {
          _arg.push(`-ac_name=${chain}`);
  
          if (api.appConfig.general.native.dataDir.length) {
            _arg.push(`-datadir=${api.appConfig.general.native.dataDir + (key !== 'komodod' ? '/' + key : '')}`);
          }
        } else if (
          key === 'komodod' &&
          api.appConfig.general.native.dataDir.length
        ) {
          _arg.push(`-datadir=${api.appConfig.general.native.dataDir}`);
        }
  
        _arg.push('stop');

        api.native.callDaemon(chain == null ? "KMD" : chain, 'stop', [])
        .then(res => {
          api.log(`sent stop sig to ${key}, got result:`, '\nnative.process');
          api.log(`${res}\n`, 'native.process')
        })
        .catch(e => {
          api.log(`error sending stop sig to ${key}:`, '\nnative.process');
          api.log(`${e.message}\n`, 'native.process')
        })
      }
  
      const didDaemonQuit = () => {
        // workaround for AGT-65
        const _port = api.assetChainPorts[key];
          portscanner.checkPortStatus(_port, '127.0.0.1', (error, status) => {
            // Status is 'open' if currently in use or 'closed' if available
            if (status === 'closed') {
              api.log(`${key} shut down succesfully, cleaning up...`, 'native.process');
              delete api.startedDaemonRegistry[key];
              delete api.native.startParams[key];

              Object.keys(api.native.cache).map(cacheType => {
                delete api.native.cache[cacheType][key];
              });

              if (api.rpcConf[key] && api.rpcConf[key].updateTimeoutId) {
                clearTimeout(api.rpcConf[key].updateTimeoutId)
              }

              delete api.rpcConf[key];

              clearInterval(coindPingInterval[key]);
              clearInterval(coindStopInterval[key]);
              resolve(true)
            } else {
              api.log(`${key} is still running...`, 'native.process');
            }
          });
      }
  
      api.log(`trying to safely quit ${key}`, 'native.process');
      execCliStop();
      coindStopInterval[key] = setInterval(() => {
        execCliStop();
      }, timeout)

      coindPingInterval[key] = setInterval(() => {
        api.log(`Checking if ${key} has quit...`, 'native.process');
        didDaemonQuit();
      }, 1000);
    })
  }

  api.quitKomodod = (timeout = 30000) => {
    // if komodod is under heavy load it may not respond to cli stop the first time
    // exit komodod gracefully
    api.lockDownAddCoin = true;

    for (let key in api.startedDaemonRegistry) {
      if (api.appConfig.general.native.stopNativeDaemonsOnQuit) {
        api.quitDaemon(key, timeout);
      } else {
        delete api.coindPingInterval[key];
      }
    }
  }

  api.setPost('/native/remove_coin', (req, res) => {
    const _chain = req.body.chainTicker === 'KMD' ? 'komodod' : req.body.chainTicker;
    
    api.quitDaemon(_chain, 30000)
    .then(result => {
      res.send(JSON.stringify({
        msg: 'success',
        result: 'daemon stopped',
      }));
    })
    .catch(e => {
      const retObj = {
        msg: "error",
        result: e.message,
      };

      res.send(JSON.stringify(retObj));
    }) 
  });

  return api;
};
