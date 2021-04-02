const { pushMessage } = require('../../../ipc/ipc');
const { ReservedPluginTypes } = require('../../utils/plugin/builtin');

module.exports = (api) => {
  api.authenticator = {}

  api.authenticator.authenticate = async (chainTicker, mode, originAppId, originBuiltin) => {
    return new Promise((resolve, reject) => {
      try {
        api.startPlugin(ReservedPluginTypes.VERUS_DESKTOP_AUTHENTICATOR, true, (data = {authorized: false}) => {
          resolve(data)
        }, (pluginWindow) => {
          pushMessage(pluginWindow, {
            ticker: chainTicker,
            mode: mode,
            origin_app_info: {
              id: originAppId,
              search_builtin: originBuiltin
            },
            launch_config: {}
          }, "VERUS_DESKTOP_AUTHENTICATOR_COIN_REQUEST")
        }, 630, 350)
      } catch(e) {reject(e)}
    })
  }

  api.setPost('/plugin/builtin/authenticator/authenticate', async (req, res, next) => {
    const { chainTicker, mode } = req.body
    const { app_id, builtin } = req.api_header
   
    try {
      const retObj = {
        msg: 'success',
        result: await api.authenticator.authenticate(chainTicker, mode, app_id, builtin),
      };

      res.send(JSON.stringify(retObj));
    } catch (e) {
      const retObj = {
        msg: 'error',
        result: e.message,
      };

      res.send(JSON.stringify(retObj));
    }
  });

  return api;
};