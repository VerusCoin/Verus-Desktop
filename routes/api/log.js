const fs = require('fs-extra');
const path = require('path')
const { secondsToString } = require('agama-wallet-lib/src/time');

module.exports = (api) => {
  api.log = (msg, type) => {
    if (api.isDevMode === true || api.appConfig.general.main.debug) {
      if (type) {
        console.log(`\x1b[94m${type}`, '\x1b[0m', msg);
      } else {
        console.log(msg);
      }
    }

    if (api.appConfig.general.main.livelog) {
      api.writeLog(msg, type)
    }

    api.appRuntimeLog.push({
      time: Date.now(),
      msg: msg,
      type: type,
    });
  }

  api.writeLog = (data, type) => {
    const logLocation = api.paths.agamaDir;
    const timeFormatted = new Date(Date.now()).toLocaleString('en-US', { hour12: false });
    const livelogPath = path.join(logLocation, 'Verus-Desktop.log')

    if (fs.existsSync(livelogPath)) {
      fs.appendFile(livelogPath, `${timeFormatted} [${type}] ${data}\r\n`, (err) => {
        if (err) {
          api.log('error appending live log file');
        }
      });
    } else {
      fs.writeFile(livelogPath, `${timeFormatted} [${type}] ${data}\r\n`, (err) => {
        if (err) {
          api.log('error writing live log file');
        }
      });
    }
  }

  api.clearWriteLog = () => {
    const logLocation = api.paths.agamaDir;
    const livelogPath = path.join(logLocation, 'Verus-Desktop.log')

    if (fs.existsSync(livelogPath)) {
      fs.writeFileSync(livelogPath, '');
    } 
  }

  api.getAppRuntimeLog = () => {
    return new Promise((resolve, reject) => {
      resolve(api.appRuntimeLog);
    });
  };

  api.printDirs = () => {
    api.log("DIR PATHS:", 'env')
    for (const pathType in api.paths) {
      api.log(`${pathType}: ${api.paths[pathType]}`, 'env')
    }
  }

  return api;
};
