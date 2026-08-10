module.exports = (api) => {
  const PRE_STOP_STAGE = "pre-stop"
  const STOPPING_STAGE = "stopping"
  const WAITING_FOR_STOP_STAGE = "waiting-for-stop"
  const RELAUNCHING_STAGE = "relaunching"
  const pollIntervalMs = Number.isInteger(api.restartPollIntervalMs) &&
      api.restartPollIntervalMs > 0
    ? api.restartPollIntervalMs
    : 1000
  const pollTimeoutMs = Number.isInteger(api.restartPollTimeoutMs) &&
      api.restartPollTimeoutMs > 0
    ? api.restartPollTimeoutMs
    : 5000
  const maxPollAttempts = Number.isInteger(api.restartMaxPollAttempts) &&
      api.restartMaxPollAttempts >= 0
    ? api.restartMaxPollAttempts
    : 20

  const daemonIsRunningWithTimeout = (daemon) => new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out while checking whether ${daemon} stopped`)),
      pollTimeoutMs
    )

    Promise.resolve(api.isDaemonRunning(daemon)).then(
      (running) => {
        clearTimeout(timeout)
        resolve(running)
      },
      (error) => {
        clearTimeout(timeout)
        reject(error)
      }
    )
  })

  const restartState = (stage, daemonStopInitiated) => ({
    stage,
    daemonStopInitiated,
  })

  const asRestartError = (error, stage) => {
    const state = restartState(stage, true)
    const message = error && typeof error.message === "string"
      ? error.message
      : typeof error === "string"
        ? error
        : "Native daemon restart failed"
    const restartError = new Error(message)
    restartError.restartState = state
    if (error && typeof error.stack === "string") restartError.stack = error.stack
    return restartError
  }

  const getRestartState = (error) => {
    if (
      error != null &&
      error.restartState != null &&
      error.restartState.daemonStopInitiated === true
    ) {
      return restartState(error.restartState.stage, true)
    }

    return restartState(PRE_STOP_STAGE, false)
  }

  api.native.restartCoin = async (
    chainTicker,
    launchConfig,
    startupOptions,
    nativeAuthorizationContext = null
  ) => {
    api.native.validateLaunchConfig(chainTicker, launchConfig, startupOptions)
    api.native.assertStartupAuthorization(
      chainTicker,
      launchConfig,
      startupOptions,
      nativeAuthorizationContext
    )
    if (!api.coinsInitializing[chainTicker]) {
      api.log('initiating restart for ' + chainTicker, 'restartCoin')
      api.coinsInitializing[chainTicker] = true

      let stage = STOPPING_STAGE
      try {
        await api.quitDaemon(chainTicker === 'KMD' ? 'komodod' : chainTicker, 30000)

        stage = WAITING_FOR_STOP_STAGE
        let tries = 0
        while (true) {
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
          api.log('checking if ' + launchConfig.daemon + " process has finished", 'restartCoin')

          const daemonIsRunning = await daemonIsRunningWithTimeout(launchConfig.daemon)
          if (!daemonIsRunning || tries >= maxPollAttempts) {
            if (!daemonIsRunning) {
              api.log(`${launchConfig.daemon} no longer running, starting ${launchConfig.daemon}`, 'restartCoin')
            } else {
              api.log(`${tries} restart checks have passed, trying to launch daemon anyways`, 'restartCoin')
            }

            delete api.native.launchConfigs[chainTicker]
            api.native.launchConfigs[chainTicker] = launchConfig
            stage = RELAUNCHING_STAGE
            return await api.native.addCoin(
              chainTicker,
              launchConfig,
              startupOptions,
              nativeAuthorizationContext
            )
          }
          tries++
        }
      } catch (error) {
        // A failed status check or relaunch must not leave the chain permanently
        // marked as initializing. The caller receives the concrete error and
        // may safely retry after checking daemon state.
        delete api.coinsInitializing[chainTicker]
        throw asRestartError(error, stage)
      }
    } else {
      api.log('cannot restart ' + chainTicker + ' while it is being initialized', 'restartCoin')
      return Promise.reject(new Error(`Cannot restart ${chainTicker} daemon while it is being initialized`))
    }
  }

  api.setPost('/native/coins/restart', (req, res) => {
    const { chainTicker, launchConfig, startupOptions } = req.body
    
    api.native.restartCoin(
      chainTicker,
      launchConfig,
      startupOptions,
      req.native_authorization
    )
    .then(result => {
      res.send(JSON.stringify({
        msg: 'success',
        result,
      }));
    })
    .catch(e => {
      const retObj = {
        msg: "error",
        result: e && e.message ? e.message : "Native daemon restart failed",
        // The renderer must preserve its live refresh state when authorization
        // or validation rejects the request, but discard it once daemon
        // shutdown has begun. Keep this machine-readable distinction separate
        // from the user-facing error string.
        restartState: getRestartState(e),
      };

      res.send(JSON.stringify(retObj));
    })
  }, true);

  return api;
};
