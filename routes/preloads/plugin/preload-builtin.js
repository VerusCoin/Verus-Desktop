const {
  contextBridge,
  shell,
  ipcRenderer
} = require("electron");
const fs = require('fs')
const os = require('os')
const url = require('url')

const generateOpenExternalSafe = require('../../workers/openExternalSafe')
const arch = require('arch');
const chainParams = require("../../chainParams")
const assetChainPorts = require("../../ports")
const version = require('../../../version.json');
const { pathsAgama } = require("../../api/pathsUtil");
const appConfig = require("../../appConfig").config

let apiShell = {}
pathsAgama(apiShell, os.platform() === "win32" ? process.env.APPDATA : process.env.HOME)

contextBridge.exposeInMainWorld("bridge", {
  getConfigSync: () =>
    JSON.parse(
      fs.readFileSync(`${apiShell.paths.agamaDir}/config.json`, "utf8")
    ),
  getSecretSync: () => JSON.parse(fs.readFileSync(`${apiShell.paths.agamaDir}/builtinsecret.json`, "utf8")).data,
  defaultConfig: appConfig,
  shell: {
    openExternal: generateOpenExternalSafe(shell, url),
  },
  assetChainPorts,
  appBasicInfo: {
    name: "Verus Desktop",
    mode: global.USB_MODE ? "usb" : "standard",
    version: version.version,
  },
  arch: arch(),
  chainParams
});

ipcRenderer.on('ipc', (_, msg) => {
  try {
    if (msg.type === 'response' || msg.type === 'push'|| msg.type === 'init') {
      window.postMessage(JSON.stringify(msg), '*');
    }
  } catch (err) {
    console.error(err);
  }
});