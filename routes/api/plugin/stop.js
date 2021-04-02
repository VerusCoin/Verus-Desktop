module.exports = (api) => {
  api.stopPlugin = async (app_id, window_id, builtin, data) => {
    try {
      let plugin;
      let pluginWindow;
      let onComplete;
      const category = builtin ? "builtin" : "registry"

      try {
        plugin = await api.getPlugin(app_id, builtin)
      } catch(e) {
        api.log("failed to get plugin info for plugin with id " + app_id, "stopPlugin")
        throw e
      }

      try {
        pluginWindow = api.pluginWindows[category][app_id][window_id]

        if (!pluginWindow) throw new Error(`plugin (id: ${app_id}) is not running with window (id: ${window_id})`)
      } catch(e) {
        api.log(`plugin (id: ${app_id}) is not running with window (id: ${window_id})`, "stopPlugin")
        throw new Error(`plugin (id: ${app_id}) is not running with window (id: ${window_id})`)
      }

      try {
        onComplete = api.pluginOnCompletes[category][app_id][window_id]
      } catch(e) {}

      if (onComplete != null) {
        try {
          await onComplete(data)
        } catch(e) {
          api.log(`plugin (id: ${app_id}) onComplete failed to execute, closing anyway...`, "stopPlugin")
          api.log(e, "stopPlugin")
        }
      }
      
      pluginWindow.close()
      return;
    } catch(e) {
      api.log(`Error stopping plugin with id ${app_id}.`, 'stopPlugin')
      api.log(e, 'stopPlugin')
      throw e
    }
  }

  api.setPost('/plugin/close', async (req, res, next) => {
    const { app_id, window_id, builtin, data } = req.body
   
    try {
      const retObj = {
        msg: 'success',
        result: await api.stopPlugin(app_id, window_id, builtin, data),
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