const { dialog, BrowserWindow } = require('electron');
const path = require('path');
const { initMessage } = require('../../ipc/ipc');

module.exports = (api) => {
  api.startPlugin = async (
    id,
    builtin,
    onComplete = (data) => {},
    onFinishLoad = (window, id, builtin) => {},
    width = 1280,
    height = 850
  ) => {
    try {
      let plugin;
      const category = builtin ? "builtin" : "registry";

      try {
        plugin = await api.getPlugin(id, builtin);
      } catch (e) {
        api.log("failed to get plugin info", "startPlugin");
        throw e;
      }

      const pluginWindow = new BrowserWindow({
        width,
        height,
        frame: true,
        icon: plugin.logo,
        show: false,
        title: plugin.name,
        webPreferences: {
          allowRunningInsecureContent: false,
          contextIsolation: true,
          enableRemoteModule: false,
          nativeWindowOpen: false,
          nodeIntegration: false,
          nodeIntegrationInWorker: false,
          nodeIntegrationInSubFrames: false,
          safeDialogs: true,
          webSecurity: true,
          webviewTag: false,
          sandbox: builtin ? false : true,

          preload: builtin
            ? path.resolve(
                __dirname,
                "../",
                "../",
                "preloads",
                "plugin",
                "preload-builtin.js"
              )
            : path.resolve(
                __dirname,
                "../",
                "../",
                "preloads",
                "plugin",
                "preload-default.js"
              ),
        },
      });

      if (api.pluginWindows[category][id] != null) {
        api.pluginWindows[category][id] = { [pluginWindow.id]: pluginWindow };
      } else {
        api.pluginWindows[category][id] = {
          ...api.pluginWindows[category][id],
          [pluginWindow.id]: pluginWindow,
        };
      }

      if (api.pluginOnCompletes[category][id] != null) {
        api.pluginOnCompletes[category][id] = { [pluginWindow.id]: onComplete };
      } else {
        api.pluginOnCompletes[category][id] = {
          ...api.pluginOnCompletes[category][id],
          [pluginWindow.id]: onComplete,
        };
      }

      pluginWindow.webContents.on("did-finish-load", () => {
        setTimeout(() => {
          pluginWindow.show();
          initMessage(
            pluginWindow,
            api.appConfig.general.main.agamaPort,
            id,
            60000,
            api.appConfig.general.main.encryptApiPost
          );

          onFinishLoad(pluginWindow, id, builtin);
        }, 40);
      });

      pluginWindow.webContents.on("devtools-opened", () => {
        dialog.showMessageBox(pluginWindow, {
          type: "warning",
          title: "Be Careful!",
          message:
            "WARNING! You are opening the developer tools menu. ONLY enter commands here if you know exactly what you are doing. If someone told you to copy+paste commands into here, you should probably ignore them, close dev tools, and stay safe.",
          buttons: ["OK"],
        });
      });

      // close app
      pluginWindow.on("close", (event) => {
        event.preventDefault()
        onComplete()
        
        delete api.pluginWindows[category][id][pluginWindow.id];
        delete api.pluginOnCompletes[category][id][pluginWindow.id];

        pluginWindow.destroy()
      });

      pluginWindow.loadFile(plugin.index);
    } catch (e) {
      api.log(`Error starting plugin with id ${id}.`, "startPlugin");
      api.log(e, "startPlugin");
      throw e;
    }
  };

  api.setPost('/plugin/run', async (req, res, next) => {
    const { id } = req.body
   
    try {
      const retObj = {
        msg: 'success',
        result: await api.startPlugin(id),
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