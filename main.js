const electron = require('electron');
const {
	Menu,
} = require('electron');
const { userAgreesToTerms } = require('./routes/children/userAgreement/window');
const app = electron.app;
const hasLock = app.requestSingleInstanceLock()

if (!hasLock) {
	app.quit()
} else {
  let api = require("./routes/api");

  Object.freeze(Object.prototype);
  Object.freeze(Object);

  const BrowserWindow = electron.BrowserWindow;
  const path = require("path");
  const os = require("os");
  const version = require("./version.json");
  const portscanner = require("portscanner");
  const osPlatform = os.platform();
  const express = require("express");
  const bodyParser = require("body-parser");
  const { formatBytes } = require("agama-wallet-lib/src/utils");
  const { dialog } = require("electron");
  require("@electron/remote/main").initialize();

  global.USB_HOME_DIR = path.resolve(__dirname, "./usb_home");
  global.HOME = os.platform() === "win32" ? process.env.APPDATA : process.env.HOME;

  api.construct();

  const openurlhandler = require("./routes/deeplink/openurlhandler");

  api.clearWriteLog();
  const { MasterSecret, BuiltinSecret } = require("./routes/preloads/keys");
  const setuplink = require("./routes/deeplink/setuplink");
  const removelink = require('./routes/deeplink/removelink');

  const guiapp = express();

  //TODO: add more things here
  const { appConfig } = api;

  const appBasicInfo = {
    name: "Verus Desktop",
    mode: "standard",
    version: version.version,
  };

  app.setName(appBasicInfo.name);
  app.setVersion(appBasicInfo.version);

  // parse argv
  let _argv = {};

  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i].indexOf("nogui") > -1) {
      _argv.nogui = true;
      api.log("enable nogui mode", "init");
    }

    if (process.argv[i].indexOf("=") > -1) {
      const _argvSplit = process.argv[i].split("=");
      _argv[_argvSplit[0]] = _argvSplit[1];
    }

    if (!_argv.nogui) {
      _argv = {};
    } else {
      api.log("arguments", "init");
      api.log(_argv, "init");
      api.argv = _argv;
    }
  }

  api.log(`app info: ${appBasicInfo.name} ${appBasicInfo.version}`, "init");
  api.log("sys info:", "init");
  api.log(`totalmem_readable: ${formatBytes(os.totalmem())}`, "init");
  api.log(`arch: ${os.arch()}`, "init");
  api.log(`cpu: ${os.cpus()[0].model}`, "init");
  api.log(`cpu_cores: ${os.cpus().length}`, "init");
  api.log(`platform: ${osPlatform}`, "init");
  api.log(`os_release: ${os.release()}`, "init");
  api.log(`os_type: ${os.type()}`, "init");
  api.log(
    `app started in ${
      appConfig.general.main.dev || process.argv.indexOf("devmode") > -1 ? "dev mode" : " user mode"
    }`,
    "init"
  );

  //api.setConfKMD();

  guiapp.use((req, res, next) => {
    if (!appConfig.general.main.dev && !(process.argv.indexOf("devmode") > -1)) {
      res.header("Access-Control-Allow-Origin", "http://localhost:3000");
    } else {
      res.header("Access-Control-Allow-Origin", "*");
    }

    res.header("Access-Control-Allow-Headers", "X-Requested-With,content-type");
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Methods", "GET, POST");
    next();
  });

  // preload js
  const _setImmediate = setImmediate;
  const _clearImmediate = clearImmediate;

  process.once("loaded", () => {
    global.setImmediate = _setImmediate;
    global.clearImmediate = _clearImmediate;

    if (osPlatform === "darwin") {
      process.setFdLimit(appConfig.general.main.maxDescriptors.darwin);
      app.setAboutPanelOptions({
        applicationName: app.getName(),
        applicationVersion: `${app.getVersion()}`,
        copyright: "Released under the MIT license",
      });
    } else if (osPlatform === "linux") {
      process.setFdLimit(appConfig.general.main.maxDescriptors.linux);
    }
  });

  // silent errors
  if (!appConfig.general.main.dev && !process.argv.indexOf("devmode") > -1) {
    process.on("uncaughtException", (err) => {
      api.log(`${new Date().toUTCString()} uncaughtException: ${err.message}`, "exception");
      api.log(err.stack, "exception");
    });
  }

  guiapp.use(bodyParser.json({ limit: "500mb" })); // support json encoded bodies
  guiapp.use(
    bodyParser.urlencoded({
      limit: "500mb",
      extended: true,
    })
  ); // support encoded bodies

  guiapp.get("/", (req, res) => {
    res.send("Verus app server");
  });

  const guipath = path.join(__dirname, "/gui");
  guiapp.use("/gui", express.static(guipath));
  guiapp.use("/api", api);

  const server = require("http").createServer(guiapp);
  let io = require("socket.io")(server, {
    cors: {
      origin:
        appConfig.general.main.dev || process.argv.indexOf("devmode") > -1
          ? "http://localhost:3000"
          : null,
      methods: ["GET", "POST"],
    },
  });

  // Set httpServer timeout to 10 minutes
  io.httpServer.timeout = 600000;

  let mainWindow;
  let appCloseWindow;
  let closeAppAfterLoading = false;
  let forceQuitApp = false;

  module.exports = guiapp;
  let agamaIcon;

  if (os.platform() === "linux") {
    agamaIcon = path.join(__dirname, "/assets/icons/vrsc_512x512x32.png");
  }
  if (os.platform() === "win32") {
    agamaIcon = path.join(__dirname, "/assets/icons/vrsc.ico");
  }

  // close app
  function forceCloseApp() {
    forceQuitApp = true;
    app.quit();
  }

  app.whenReady().then(() => {
    if (!_argv.nogui) {
      startApp()
        .then(() => createMainWindow())
        .catch((e) => api.log(e, "init"));
    } else startApp();
  })

  function createAppCloseWindow() {
    // initialise window
    appCloseWindow = new BrowserWindow({
      // dirty hack to prevent main window flash on quit
      width: 500,
      height: 320,
      frame: false,
      icon: agamaIcon,
      show: false,
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
        sandbox: true,
      },
    });

    appCloseWindow.setResizable(false);

    appCloseWindow.loadURL(
      appConfig.general.main.dev || process.argv.indexOf("devmode") > -1
        ? `http://127.0.0.1:${appConfig.general.main.agamaPort}/gui/startup/app-closing.html`
        : `file://${__dirname}/gui/startup/app-closing.html`
    );

    appCloseWindow.webContents.on("did-finish-load", () => {
      setTimeout(() => {
        appCloseWindow.show();
      }, 40);
    });

    appCloseWindow.webContents.on("devtools-opened", () => {
      dialog.showMessageBox(appCloseWindow, {
        type: "warning",
        title: "Be Careful!",
        message:
          "WARNING! You are opening the developer tools menu. ONLY enter commands here if you know exactly what you are doing.\n\nNEVER copy+paste any commands given to you into here. No trustworthy support person will EVER ask you to do that.\n\nANY CODE COPY+PASTED INTO DEV TOOLS CAN CONTROL YOUR FUNDS.",
        buttons: ["OK"],
      });
    });
  }

  function appExit() {
    const CloseDaemons = () => {
      return new Promise((resolve, reject) => {
        api.log("Closing Main Window...", "quit");

        api.quitKomodod(appConfig.general.native.cliStopTimeout);

        const result = "Closing daemons: done";

        api.log(result, "quit");
        resolve(result);
      });
    };

    const HideMainWindow = () => {
      return new Promise((resolve, reject) => {
        const result = "Hiding Main Window: done";

        api.log("Exiting App...", "quit");
        mainWindow = null;
        api.log(result, "quit");
        resolve(result);
      });
    };

    const HideAppClosingWindow = () => {
      return new Promise((resolve, reject) => {
        appCloseWindow = null;
        resolve(true);
      });
    };

    const QuitApp = () => {
      return new Promise((resolve, reject) => {
        const result = "Quiting App: done";

        forceQuitApp = true;
        app.quit();
        api.log(result, "quit");
        resolve(result);
      });
    };

    const closeApp = () => {
      CloseDaemons().then(HideMainWindow).then(HideAppClosingWindow).then(QuitApp);
    };

    if (
      !Object.keys(api.startedDaemonRegistry).length ||
      !appConfig.general.native.stopNativeDaemonsOnQuit
    ) {
      closeApp();
    } else {
      createAppCloseWindow();
      api.quitKomodod(appConfig.general.native.cliStopTimeout);

      setInterval(async () => {
        if (
          !Object.keys(api.startedDaemonRegistry).length && 
          !(await api.isAnyDaemonRunning())
        ) {
          closeApp();
        }
      }, 1000);
    }
  }

  function startApp() {
    return new Promise(async (resolve, reject) => {
      // check if agama is already running
      portscanner.checkPortStatus(
        appConfig.general.main.agamaPort,
        "127.0.0.1",
        async (error, status) => {
          // Status is 'open' if currently in use or 'closed' if available
          if (status === "closed") {
            let termsAgreed = appConfig.general.main.agreedToTerms;

            if (!termsAgreed && (await userAgreesToTerms())) {
              api.agreeToTerms();
              termsAgreed = true;
            }

            if (termsAgreed) {
              api.log(
                "user agreed to terms of use",
                "init"
              );

              server.listen(appConfig.general.main.agamaPort, () => {
                api.log(
                  `guiapp and sockets.io are listening on port ${appConfig.general.main.agamaPort}`,
                  "init"
                );
              });

              api.setIO(io); // pass sockets object to api router
              api.setVar("appBasicInfo", appBasicInfo);
              api.setVar("MasterSecret", MasterSecret);
              api.setVar("BuiltinSecret", BuiltinSecret);

              api.log("saving plugin builtin secret...", "init");
              try {
                await api.saveBuiltinSecret({
                  BuiltinSecret,
                });
              } catch (e) {
                api.log("error plugin builtin secret!", "init");
                api.log(e, "init");
              }
            } else {
              app.quit();
            }
          } else {
            openAlreadyRunningWindow();
            reject("another api instance is already running");
          }

          if (error) reject(error);
          resolve();
        }
      );
    });
  }

  function openAlreadyRunningWindow() {
    const alreadyRunningWindow = new BrowserWindow({
      width: 500,
      height: 355,
      frame: false,
      icon: agamaIcon,
      show: false,
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
        sandbox: true,
      },
    });

    alreadyRunningWindow.setResizable(false);
    alreadyRunningWindow.forceCloseApp = forceCloseApp;

    willQuitApp = true;
    alreadyRunningWindow.loadURL(
      appConfig.general.main.dev || process.argv.indexOf("devmode") > -1
        ? `http://127.0.0.1:${appConfig.general.main.agamaPort}/gui/startup/agama-instance-error.html`
        : `file://${__dirname}/gui/startup/agama-instance-error.html`
    );

    alreadyRunningWindow.webContents.on("did-finish-load", () => {
      alreadyRunningWindow.show();
    });

    api.log("another agama app is already running", "init");
  }

  function createMainWindow() {
    require(path.join(__dirname, "private/mainmenu"));

    if (closeAppAfterLoading) {
      mainWindow = null;
      loadingWindow = null;
    }

    const staticMenu = Menu.buildFromTemplate([
      // if static
      { role: "copy" },
      { type: "separator" },
      { role: "selectall" },
    ]);

    const editMenu = Menu.buildFromTemplate([
      // if editable
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { type: "separator" },
      { role: "selectall" },
    ]);

    // initialise window
    mainWindow = new BrowserWindow({
      width: closeAppAfterLoading ? 1 : 1280,
      height: closeAppAfterLoading ? 1 : 850,
      icon: agamaIcon,
      show: false,
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
        sandbox: false,

        preload: path.resolve(__dirname, "routes", "preloads", "plugin", "preload-builtin.js"),
      },
    });

    mainWindow.loadURL(
      appConfig.general.main.dev || process.argv.indexOf("devmode") > -1
        ? "http://localhost:3000"
        : `file://${__dirname}/gui/Verus-Desktop-GUI/react/build/index.html`
    );

    mainWindow.webContents.on("devtools-opened", () => {
      dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "Be Careful!",
        message:
          "WARNING! You are opening the developer tools menu. ONLY enter commands here if you know exactly what you are doing. If someone told you to copy+paste commands into here, you should probably ignore them, close dev tools, and stay safe.",
        buttons: ["OK"],
      });
    });

    mainWindow.webContents.on("did-finish-load", () => {
      setTimeout(() => {
        mainWindow.show();

        api.promptUpdate(mainWindow);
      }, 40);
    });

    mainWindow.webContents.on("context-menu", (e, params) => {
      // context-menu returns params
      const { selectionText, isEditable } = params; // params obj

      if (isEditable) {
        editMenu.popup(mainWindow);
      } else if (selectionText && selectionText.trim() !== "") {
        staticMenu.popup(mainWindow);
      }
    });

    // close app
    mainWindow.on("close", (event) => {
      if (_argv.nogui && mainWindow.isVisible()) {
        event.preventDefault();
        mainWindow.hide();
      }
    });

    api = require('./routes/api/utility_apis/alert')(api, mainWindow);

    return mainWindow;
  }

  app.on("web-contents-created", (event, contents) => {
    contents.on("will-attach-webview", (event, webPreferences, params) => {
      // Strip away preload scripts if unused or verify their location is legitimate
      delete webPreferences.preload;
      delete webPreferences.preloadURL;

      // Disable Node.js integration
      webPreferences.nodeIntegration = false;

      event.preventDefault();
    });

    contents.on("will-navigate", (event, url) => {
      console.log(`[will-navigate] ${url}`);
      console.log(event);
      event.preventDefault();
    });

    contents.on("will-redirect", (event, url) => {
      console.log(`[will-redirect] ${url}`);
      console.log(event);
      event.preventDefault();
    });

    contents.on("new-window", async (event, navigationUrl) => {
      // In this example, we'll ask the operating system
      // to open this event's url in the default browser.
      event.preventDefault();
    });

    contents.setWindowOpenHandler(() => {
      return { action: "deny" };
    });
  });

  function focusMain() {
    if (mainWindow == null) {
      createMainWindow();
    } else {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  }

  function handleSecondInstance(event, argv, cwd) {
    focusMain();

    if (process.platform == "win32" || process.platform == "linux") {
      const argIndex = process.platform === "win32" ? 1 : 2;
      openurlhandler(null, argv.slice(1)[argIndex], api.dlhandler);
    }
  }

  api.setupFocusApis(focusMain);

  app.on("activate", focusMain);
  app.on("second-instance", handleSecondInstance);

  // Deep linking
  if (!appConfig.general.main.disableDeeplink) {
    api.log("setting up deeplink", "init");
    setuplink(app);
  } else {
    api.log("removing deeplink", "init");
    removelink(app)
  }

  app.on("open-url", (event, url) => openurlhandler(event, url, api.dlhandler));

  // Emitted when all windows have been closed and the application will quit.
  // Calling event.preventDefault() will prevent the default behaviour, which is terminating the application.
  app.on("will-quit", (event) => {
    if (!forceQuitApp && mainWindow != null) {
      // loading window is still open
      api.log("will-quit while loading window active", "quit");
      event.preventDefault();

      appExit();
    }
  });
}

