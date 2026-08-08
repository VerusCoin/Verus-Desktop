const os = require('os');
const { DAEMON_NAMES } = require('./utils/constants');
const { execFile } = require('child_process');

module.exports = (api) => {
  api.killRogueProcess = (processName) => {
    if (!DAEMON_NAMES.includes(processName)) {
      return Promise.reject(new Error("Invalid daemon name"));
    }

    return api.isDaemonRunning(processName).then((running) => {
      if (!running) return false;

      const osPlatform = os.platform();
      const command = osPlatform === "win32" ? "taskkill" : "pkill";
      const args = osPlatform === "win32"
        ? ["/f", "/im", `${processName}.exe`]
        : ["-15", processName];

      api.log(`found another ${processName} process(es)`, "native.process");
      return new Promise((resolve, reject) => {
        execFile(command, args, (error) => {
          if (error) return reject(error);
          api.log(`${command} ${args.join(" ")} is issued`, "native.process");
          return resolve(true);
        });
      });
    });
  }

  api.isDaemonRunning = (daemonName) => {
    if (!DAEMON_NAMES.includes(daemonName)) {
      return Promise.reject(new Error("Invalid daemon name"));
    }

    return new Promise((resolve, reject) => {
      const platform = os.platform();
      let command;
      let args;
      switch (platform) {
          case 'win32': command = "tasklist"; args = []; break;
          case 'darwin': command = "ps"; args = ["-ax"]; break;
          case 'linux': command = "ps"; args = ["-A"]; break;
          default: return reject(new Error(`Unsupported platform: ${platform}`));
      }

      const onProcessList = (err, stdout) => {
        if (err) {
          // This helper is polled from async interval callbacks during restart
          // and shutdown. Preserve the old best-effort behavior so a failed
          // process listing cannot become an unhandled rejection.
          api.log(`Unable to inspect running daemons: ${err.message}`, "native.process");
          return resolve(false);
        }
        const output = stdout.toLowerCase();
        if (platform === 'darwin') {
          return resolve(output.indexOf(`assets/bin/osx/${daemonName.toLowerCase()}`) > -1)
        } else {
          return resolve(output.indexOf(daemonName.toLowerCase()) > -1)
        }
      };

      try {
        execFile(command, args, onProcessList);
      } catch (error) {
        onProcessList(error, "");
      }
    })      
  }

  api.isAnyDaemonRunning = async () => {
    for (const daemon of DAEMON_NAMES) {
      if (await api.isDaemonRunning(daemon)) {
        api.log(`${daemon} is currently running...`, 'native.process');
        return true;
      } else {
        api.log(`${daemon} is not currently running...`, 'native.process');
      }
    }
    return false;
  }

  return api;
};
