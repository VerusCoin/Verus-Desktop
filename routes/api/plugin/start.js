const { BrowserWindow } = require('electron');
const fs = require("fs");
const path = require('path');
const { initMessage } = require('../../ipc/ipc');
const { isDevToolsShortcut } = require('../../security/runtimeMode');

const BUILTIN_PLUGIN_ROOT = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "assets",
  "plugins",
  "builtin"
);

const canonicalBuiltinRoot = (builtinRoot) => {
  const root = fs.realpathSync(builtinRoot);
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error("Packaged built-in assets must not contain symbolic links");
      }
      if (entry.isDirectory()) visit(entryPath);
      else if (!entry.isFile()) {
        throw new Error("Packaged built-in assets must contain regular files only");
      }
    }
  };
  visit(root);
  return root;
};

const packagedBuiltinUrl = (
  pluginIndex,
  port,
  builtinRoot = BUILTIN_PLUGIN_ROOT
) => {
  if (typeof pluginIndex !== "string" || !pluginIndex) {
    throw new Error("Packaged built-in entry point is unavailable");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Packaged built-in server port is invalid");
  }

  const resolvedRoot = canonicalBuiltinRoot(builtinRoot);
  const resolvedIndex = fs.realpathSync(pluginIndex);
  const relativeIndex = path.relative(resolvedRoot, resolvedIndex);
  if (
    !relativeIndex ||
    path.isAbsolute(relativeIndex) ||
    relativeIndex === ".." ||
    relativeIndex.startsWith(`..${path.sep}`) ||
    (path.sep !== "\\" && relativeIndex.includes("\\"))
  ) {
    throw new Error("Packaged built-in entry point escapes the reviewed plugin directory");
  }

  const encodedPath = relativeIndex
    .split(path.sep)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `http://127.0.0.1:${port}/builtin/${encodedPath}`;
};

const installPackagedNavigationGuard = (
  webContents,
  expectedUrl,
  audit = () => {}
) => {
  if (
    webContents == null ||
    typeof webContents.on !== "function" ||
    typeof expectedUrl !== "string" ||
    !expectedUrl
  ) {
    throw new TypeError("A webContents instance and exact packaged URL are required");
  }

  const blockUnexpectedNavigation = (event, targetUrl) => {
    if (targetUrl !== expectedUrl) {
      event.preventDefault();
      audit();
    }
  };
  webContents.on("will-navigate", blockUnexpectedNavigation);
  webContents.on("will-redirect", blockUnexpectedNavigation);
  if (typeof webContents.setWindowOpenHandler === "function") {
    webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  }
  webContents.on("new-window", (event) => {
    event.preventDefault();
    audit();
  });
};

const registerPluginWindow = (
  windowRegistry,
  completionRegistry,
  category,
  id,
  pluginWindow,
  onComplete
) => {
  const existingWindows = windowRegistry[category][id];
  const existingCompletions = completionRegistry[category][id];
  windowRegistry[category][id] = {
    ...(existingWindows && typeof existingWindows === "object"
      ? existingWindows
      : {}),
    [pluginWindow.id]: pluginWindow,
  };
  completionRegistry[category][id] = {
    ...(existingCompletions && typeof existingCompletions === "object"
      ? existingCompletions
      : {}),
    [pluginWindow.id]: onComplete,
  };
};

module.exports = (api) => {
  api.startPlugin = async (
    id,
    builtin,
    onComplete = (data) => {},
    onFinishLoad = (window, id, builtin) => {},
    width = 1280,
    height = 850,
    frame = true
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
        frame,
        icon: plugin.logo,
        show: false,
        title: plugin.name,
        webPreferences: {
          allowRunningInsecureContent: false,
          contextIsolation: true,
          devTools: api.isDevMode === true,
          enableRemoteModule: false,
          nativeWindowOpen: false,
          nodeIntegration: false,
          nodeIntegrationInWorker: false,
          nodeIntegrationInSubFrames: false,
          safeDialogs: true,
          partition: builtin ? `verus-builtin-${id}` : undefined,
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

      registerPluginWindow(
        api.pluginWindows,
        api.pluginOnCompletes,
        category,
        id,
        pluginWindow,
        onComplete
      );

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

      if (api.isDevMode !== true) {
        pluginWindow.webContents.on("devtools-opened", () => {
          if (!pluginWindow.isDestroyed() && !pluginWindow.webContents.isDestroyed()) {
            pluginWindow.webContents.closeDevTools();
          }
          api.log("Blocked a production plugin DevTools open attempt", "security.devtools");
        });
        pluginWindow.webContents.on("before-input-event", (event, input) => {
          if (isDevToolsShortcut(input)) event.preventDefault();
        });
      }

      // close app
      pluginWindow.on("close", (event) => {
        event.preventDefault()
        onComplete()
        
        delete api.pluginWindows[category][id][pluginWindow.id];
        delete api.pluginOnCompletes[category][id][pluginWindow.id];

        pluginWindow.destroy()
      });

      if (api.isDevMode === true) {
        await pluginWindow.loadURL(`http://localhost:${plugin.devPort}`);
      } else if (builtin) {
        const expectedUrl = packagedBuiltinUrl(
          plugin.index,
          api.appConfig.general.main.agamaPort
        );
        installPackagedNavigationGuard(
          pluginWindow.webContents,
          expectedUrl,
          () => api.log("Blocked packaged plugin navigation", "security.navigation")
        );
        await pluginWindow.loadURL(expectedUrl);
      } else {
        await pluginWindow.loadFile(plugin.index);
      }
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

module.exports.registerPluginWindow = registerPluginWindow;
module.exports.packagedBuiltinUrl = packagedBuiltinUrl;
module.exports.installPackagedNavigationGuard = installPackagedNavigationGuard;
module.exports.canonicalBuiltinRoot = canonicalBuiltinRoot;
