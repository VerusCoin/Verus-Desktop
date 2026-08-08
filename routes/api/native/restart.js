module.exports = (api) => {
  api.native.restartCoin = async (chainTicker, launchConfig, startupOptions) => {
    api.native.validateLaunchConfig(chainTicker, launchConfig, startupOptions)
    if (!api.coinsInitializing[chainTicker]) {
      api.log('initiating restart for ' + chainTicker, 'restartCoin')
      api.coinsInitializing[chainTicker] = true
  
      await api.quitDaemon(chainTicker === 'KMD' ? 'komodod' : chainTicker, 30000)
  
      return new Promise((resolve, reject) => {
        let tries = 0
  
        const intervalId = setInterval(async () => {
          api.log('checking if ' + launchConfig.daemon + " process has finished", 'restartCoin')
          
          const resolveInterval = async () => {
            clearInterval(intervalId)
            try {
              delete api.native.launchConfigs[chainTicker]
              api.native.launchConfigs[chainTicker] = launchConfig
              
              resolve(await api.native.addCoin(chainTicker, launchConfig, startupOptions))
            } catch(e) {
              reject(e)
            }
          }
    
          if (!(await api.isDaemonRunning(launchConfig.daemon))) {
            api.log(`${launchConfig.daemon} no longer running, starting ${launchConfig.daemon}`, 'restartCoin')
            await resolveInterval()
          } else if (tries >= 20) {
            api.log(`${tries * 2} seconds have passed, trying to launch daemon anyways`, 'restartCoin')
            await resolveInterval()
          } else tries++
        }, 1000)
      })
    } else {
      api.log('cannot restart ' + chainTicker + ' while it is being initialized', 'restartCoin')
      return Promise.reject(new Error(`Cannot restart ${chainTicker} daemon while it is being initialized`))
    }
  }

  api.setPost('/native/coins/restart', (req, res) => {
    const { chainTicker, launchConfig, startupOptions } = req.body
    
    api.native.restartCoin(chainTicker, launchConfig, startupOptions)
    .then(result => {
      res.send(JSON.stringify({
        msg: 'success',
        result,
      }));
    })
    .catch(e => {
      const retObj = {
        msg: "error",
        result: e.message,
      };

      res.send(JSON.stringify(retObj));
    })
  }, true);

  return api;
};
