const fs = require('fs-extra');
const portscanner = require('portscanner');
const execFile = require('child_process').execFile;
const { generateRpcPassword } = require('./utils/auth/rpcAuth.js');
const { canFetchBootstrap } = require('../children/fetch-bootstrap/window.js');
const {
  hasStartupOption,
  validateStartupOptions,
} = require('./native/security.js');

module.exports = (api) => {
  api.isPbaasDaemon = (daemon, coin) => {
    return daemon === 'verusd' && api.appConfig.general.main.reservedChains.indexOf(coin) === -1
  }

  api.processChainArgs = (coin, paramArray) => {
    const paramString = paramArray.join(' ')
    api.native.startParams[coin] = paramString;
    return api.native.startParams[coin];
  }

  api.initLogfile = (coin) => {
    return new Promise((resolve, reject) => {
      const logName = `${api.paths.agamaDir}/${coin}.log`;

      api.log(`initializing ${coin} log file for verus-desktop`, 'native.process');
      fs.access(logName, fs.R_OK | fs.W_OK)
        .then(() => {
          api.log(`located ${logName}`, "native.debug");
          api.logFileIndex[coin] = logName
          resolve()
        })
        .catch(e => {
          if (e.code !== 'ENOENT') throw e

          api.log(
            `${logName} doesnt exist, creating new logfile...`,
            "native.process"
          );

          return fs.writeFile(logName, '').then(() => {
            api.log(
              `${logName} created, saving to log file index...`,
              "native.process"
            );
            api.logFileIndex[coin] = logName

            resolve()
          })
          .catch(e => reject(e))
        })
        .catch(e => {
          api.log(
            `error accessing ${logName}, doesnt exist or another proc is already running`,
            "native.process"
          );
          reject(e);
        })
    })
  }

  api.writeRpcUser = (confFile) => {
    return new Promise((resolve, reject) => {
      api.log(`creating rpcuser for ${confFile}...`, "native.process");
      fs.appendFile(confFile, `\nrpcuser=${generateRpcPassword()}`)
      .then(resolve)
      .catch(e => reject(e))
    })
  }

  api.writeRpcPassword = (confFile) => {
    return new Promise((resolve, reject) => {
      api.log(`creating rpcpassword for ${confFile}...`, "native.process");
      fs.appendFile(confFile, `\nrpcpassword=${generateRpcPassword()}`)
      .then(resolve)
      .catch(e => reject(e))
    })
  }
  api.writeRpcHost = (confFile) => {
    return new Promise((resolve, reject) => {
      api.log(`setting rpchost for ${confFile}...`, "native.process");
      fs.appendFile(confFile, '\nrpchost=127.0.0.1')
          .then(resolve)
          .catch(e => reject(e))
    })
  }
  api.writeRpcAllowIP = (confFile) => {
    return new Promise((resolve, reject) => {
      api.log(`setting rpcallowip for ${confFile}...`, "native.process");
      fs.appendFile(confFile, '\nrpcallowip=127.0.0.1')
          .then(resolve)
          .catch(e => reject(e))
    })
  }
  api.writeRpcPort = (coin, confFile, fallbackPort) => {
    return new Promise((resolve, reject) => {
      api.log(`creating rpcport for ${confFile}...`, "native.process");

      const appendPort = () => {
        if (api.assetChainPortsDefault[coin]) {
          api.log(`${coin} default port found...`, "native.process");
          return fs.appendFile(confFile, `\nrpcport=${api.assetChainPortsDefault[coin]}`)
        } else if (fallbackPort != null) {
          api.log(`no ${coin} default port found, using fallback...`, "native.process");
          return fs.appendFile(confFile, `\nrpcport=${fallbackPort}`)
        } else {
          api.log(`no ${coin} default port or fallback port found, finding available port...`, "native.process");

          return new Promise((resolve, reject) => {
            portscanner.findAPortNotInUse(3000, 3010, '127.0.0.1')
            .then(port => {
              api.log(`available port found at ${port}...`, "native.process");
              return fs.appendFile(confFile, `\nrpcport=${port}`)
            })
            .then(resolve)
            .catch(e => reject(e))
          })
        }
      }

      appendPort()
      .then(() => {
        api.log(`set port for ${coin} in conf...`, "native.process");
        resolve()
      })
      .catch(e => reject(e))
    })
  }

  api.writeAddNode = (address, confFile, port) => {
    let node
    if (port) {
      node = `${address}:${port}`
    } else {
      node = `${address}`
    }
    return new Promise((resolve, reject) => {
      api.log(`set addnode ${port} for ${confFile}...`, "native.process");
      fs.appendFile(confFile, `\naddnode=${node}`)
          .then(resolve)
          .catch(e => reject(e))
    })
  }

  api.writeSeedNode = (address, confFile, port) => {
    let node
    if (port) {
      node = `${address}:${port}`
    } else {
      node = `${address}`
    }
    return new Promise((resolve, reject) => {
      api.log(`set seednode ${node} for ${confFile}...`, "native.process");
      fs.appendFile(confFile,  `\nseednode=${node}`)
          .then(resolve)
          .catch(e => reject(e))
    })
  }

  api.writeAC_Supply = (confFile) => {
    return new Promise((resolve, reject) => {
      api.log(`set ac_supply for ${confFile}...`, "native.process");
      fs.appendFile(confFile, '\nac_supply=5000000000000000')
          .then(resolve)
          .catch(e => reject(e))
    })
  }
  api.initConfFile = (coin, confName, fallbackPort, ignoreEnoent = false) => {
    const coinLc = coin.toLowerCase()
    return new Promise((resolve, reject) => {
      const confFile = `${api.paths[`${coinLc}DataDir`]}/${confName == null ? coin : confName}.conf`;

      api.log(`initializing ${coinLc} conf file for verus-desktop`, 'native.process');
      fs.access(confFile, fs.R_OK | fs.W_OK)
        .then(async () => {
          api.log(`located ${confFile}`, "native.debug");
          api.confFileIndex[coin] = confFile

          api.log(`setting permissions of ${confFile} to 0600`, "native.debug");
          await fs.chmod(confFile, '0600');

          return fs.readFile(confFile, "utf8")
        })
        .then(confHandle => {
          const port = confHandle.match(/rpcport=\s*(.*)/);
          const user = confHandle.match(/rpcuser=\s*(.*)/);
          const password = confHandle.match(/rpcpassword=\s*(.*)/);
          const handleMatches = [
            {
              name: "rpcport",
              match: port,
              writePromise: () => api.writeRpcPort(coin, confFile, fallbackPort),
            },
            {
              name: "rpcuser",
              match: user,
              writePromise: () => api.writeRpcUser(confFile)
            },
            {
              name: "rpcpassword",
              match: password,
              writePromise: () => api.writeRpcPassword(confFile)
            }
          ];
          let configPromises = []

          handleMatches.map(matchObj => {
            if (matchObj.match === null) {
              api.log(
                `${matchObj.name} not found in ${coinLc} conf file, going to append manually...`,
                "native.process"
              );

              configPromises.push(matchObj.writePromise)
            }
          })

          return Promise.all(configPromises)
        })
        .then(resolve)
        .catch(e => {
          if (e.code !== 'ENOENT') throw e

          if (!ignoreEnoent) {
            api.log(
              `${confFile} doesnt exist, creating new conf file...`,
              "native.process"
            );

            return fs
              .writeFile(confFile, "", {
                mode: 0o600
              })
              .then(() => {
                api.log(
                  `${confFile} created, saving to conf file index...`,
                  "native.process"
                );
                api.confFileIndex[coin] = confFile;
                if (coin === 'VRSCTEST') {
                  return Promise.all([
                    api.writeRpcHost(confFile),
                    api.writeRpcAllowIP(confFile),
                    api.writeRpcPort(coin, confFile, fallbackPort),
                    api.writeRpcPassword(confFile),
                    api.writeRpcUser(confFile),
                    api.writeAC_Supply(confFile)
                  ]);
                } else {
                  return Promise.all([
                    api.writeRpcHost(confFile),
                    api.writeRpcAllowIP(confFile),
                    api.writeRpcPort(coin, confFile, fallbackPort),
                    api.writeRpcPassword(confFile),
                    api.writeRpcUser(confFile)
                  ]);
                }
              })
              .then(resolve)
              .catch(e => reject(e));
          } else {
            api.log(
              `${confFile} doesnt exist, ignoring as told...`,
              "native.process"
            );
            api.confFileIndex[coin] = confFile

            resolve()
          }

        })
        .catch(e => {
          api.log(
            `error accessing ${confFile}, doesnt exist or another proc is already running`,
            "native.process"
          );
          reject(e);
        })
    })
  }

  api.initCoinDir = (coinLc) => {
    return new Promise((resolve, reject) => {
      const coinDir = api.paths[`${coinLc}DataDir`];

      api.log(`initializing ${coinLc} directory file for verus-desktop`, 'native.process');
      fs.access(coinDir, fs.R_OK | fs.W_OK)
        .then(() => {
          api.log(`located ${coinDir}`, "native.debug");
          resolve(true)
        })
        .catch(e => {
          if (e.code !== 'ENOENT') throw e

          api.log(
            `${coinDir} doesnt exist, creating new coin directory...`,
            "native.process"
          );

          return fs.mkdir(coinDir,{ recursive: true }).then(() => {
            api.log(
              `${coinDir} created...`,
              "native.process"
            );

            resolve(false)
          })
          .catch(e => reject(e))
        })
        .catch(e => {
          api.log(
            `error accessing ${coinDir}, doesn't exist or another proc is already running`,
            "native.process"
          );
          reject(e);
        })
    })
  }

  api.prepareCoinPort = (coin, confName, fallbackPort) => {
    const coinLc = coin.toLowerCase()
    const confLocation = `${api.paths[`${coinLc}DataDir`]}/${
      confName ? confName : coin
    }.conf`;
    api.log(`attempting to read ${confLocation}...`, "native.process");

    if (api.assetChainPorts[coin] != null) {
      return new Promise(resolve => {
        api.log(
          `${coin} port in memory...`,
          "native.confd"
        );
        resolve();
      });
    } else {
      return new Promise((resolve, reject) => {
        fs.readFile(confLocation, "utf8")
          .then(confFile => {
            const customPort = confFile.match(/rpcport=\s*(.*)/);

            if (customPort[1]) {
              api.assetChainPorts[coin] = customPort[1];
              api.rpcConf[coin].port = customPort[1];
              api.log(
                `${coin} port read from conf file and set to ${customPort[1]}...`,
                "native.confd"
              );
              resolve();
            } else {
              api.assetChainPorts[coin] = api.assetChainPortsDefault[coin];
              api.rpcConf[coin].port = api.assetChainPortsDefault[coin];
              api.log(
                `${coin} port not found in conf file, using default port ${customPort[1]}...`,
                "native.confd"
              );
              resolve();
            }
          })
          .catch(e => {
            api.log(
              `failed to read ${coin} port from conf file, and/or it wasn't found in the default ports list!`,
              "native.process"
            );

            if (api.rpcConf[coin])
              api.rpcConf[coin].port = api.assetChainPortsDefault[coin];

            if (fallbackPort) {
              api.log(
                `fallback port detected, using ${fallbackPort}...`,
                "native.process"
              );
              api.assetChainPorts[coin] = fallbackPort;
              resolve();
            } else if (api.assetChainPortsDefault[coin] != null) {
              api.log(
                `no fallback port detected, using ${api.assetChainPortsDefault[coin]}...`,
                "native.process"
              );
              api.assetChainPorts[coin] = api.assetChainPortsDefault[coin];
              resolve();
            } else {
              api.log(
                `no fallback or default port detected! throwing error...`,
                "native.process"
              );
              reject(e);
            }
          });
      });
    }
  };

  api.checkPort = port => {
    return new Promise((resolve, reject) => {
      portscanner
        .checkPortStatus(port, "127.0.0.1")
        .then(status => {
          // Status is 'open' if currently in use or 'closed' if available
          const portStatus = status === 'closed' ? 'AVAILABLE' : 'UNAVAILABLE'
          api.log(`port check on port ${port} returned: ${portStatus}`, 'native.checkPort');

          resolve(status === 'closed' ? 'AVAILABLE' : 'UNAVAILABLE')
        })
        .catch(err => reject(err));
    });
  };

  // Spawn dameon child process
  api.spawnDaemonChild = (daemon, coin, acOptions) => {
    try {
      const daemonChild = execFile(`${api.paths[daemon + 'Bin']}`, acOptions, {
        maxBuffer: 1024 * 1000000, // 1000 mb
      }, (error, stdout, stderr) => {

        if (error !== null) {
          api.log(`exec error: ${error}`, 'native.debug');
        }
      });

      daemonChild.on('exit', (exitCode) => {
        const errMsg = `${daemon} exited with code ${exitCode}${exitCode === 0 ? '' : ', crashed?'}`;

        fs.appendFile(`${api.paths.agamaDir}/${coin}.log`, errMsg, (err) => {
          if (err) {
            api.log(errMsg, 'native.debug');
          }
          api.log(errMsg, 'native.debug');
        });
      });

      daemonChild.on('error', (err) => {
        const errMsg = `${daemon} error: ${err.message}`;

        fs.appendFile(`${api.paths.agamaDir}/${coin}.log`, errMsg, (err) => {
          if (err) {
            api.log(errMsg, 'native.debug');
          }
          api.log(errMsg, 'native.debug');
        });
      });

      api.log(`summoning ritual complete, ${daemon} daemon child spawned successfully for ${coin}.`, 'native.process');
    } catch (e) {
      api.log(`error spawning ${daemon} for ${coin} with ${acOptions}:`, 'native.process');
      api.log(e.message, 'native.process');
      throw e
    }
  }

  /**
   * Start a coin daemon provided that start params, the daemon name,
   * and optionally, the custom name of the coin data directory
   * @param {String} coin The chain ticker for the daemon to start
   * @param {String[]|Function} requestedAcOptions Options to start the coin
   * daemon with, or a function that resolves them only when a spawn is needed
   * @param {String} daemon The name of the coin daemon binary
   * @param {Object} dirNames An object containing the names of the coin data
   * directory, from the home directory of the system, on each different OS { darwin, linux, win32 }
   * @param {Number} fallbackPort (optional) The port that will be used if none if found for the coin
   */
  api.startDaemon = (
    coin,
    requestedAcOptions,
    daemon = "verusd",
    dirNames,
    confName,
    fallbackPort
  ) => {
    const coinLc = coin.toLowerCase();
    let port = null;
    let coinDirExisted = false;
    let customDataDirOption = null;

    api.log(
      `${coin} daemon activation requested with ${daemon} binary...`,
      "native.process"
    );

    return new Promise((resolve, reject) => {
      // Set coin daemon bin location into memory if it doesn't exist there yet
      if (api.paths[`${daemon}Bin`] == null) {
        api.log(
          `${daemon} binaries not used yet this session, saving their path...`,
          "native.process"
        );
        api.setDaemonPath(daemon);
        api.log(
          `${daemon} binary path set to ${api.paths[`${daemon}Bin`]}`,
          "native.process"
        );
      }

      if (
        api.appConfig.coin.native.dataDir[coin] &&
        api.appConfig.coin.native.dataDir[coin].length > 0
      ) {
        api.log(
          `custom data dir detected, setting coin dir to ${api.appConfig.coin.native.dataDir[coin]}`,
          "native.process"
        );

        api.setCoinDir(
          coinLc,
          {
            linux: api.appConfig.coin.native.dataDir[coin],
            darwin: api.appConfig.coin.native.dataDir[coin],
            win32: api.appConfig.coin.native.dataDir[coin],
          },
          true
        );

        customDataDirOption = `-datadir=${api.appConfig.coin.native.dataDir[coin]}`;
      } else {
        // if (global.USB_MODE) {
        //   acOptions.push(`-datadir=${api.paths[`${coin.toLowerCase()}DataDir`]}`)
        // }

        // Set coin data directory into memory if it doesnt exist yet
        if (api.paths[`${coinLc}DataDir`] == null) {
          api.log(
            `${coin} data directory not already saved in memory...`,
            "native.process"
          );

          if (dirNames != null) {
            api.log(
              `saving ${coin} data directory as custom specified dir...`,
              "native.process"
            );
          } else {
            reject(
              new Error(
                `Could not start ${coin} daemon, no data directory found or specified!`
              )
            );
          }

          api.setCoinDir(coinLc, dirNames);
          api.log(
            `${coin} dir path set to ${api.paths[`${coinLc}DataDir`]}...`,
            "native.process"
          );
        } else api.log(`${coin} data directory retrieved...`, "native.process");
      }

      api
        .initCoinDir(coinLc)
        .then((existed) => {
          coinDirExisted = existed;
          return Promise.all([
            api.initLogfile(coin),
            api.initConfFile(
              coin,
              confName,
              fallbackPort,
              daemon === "verusd" && coin !== "VRSC" && coin !== "VRSCTEST"
            ),
          ]);
        })
        .then(() => {
          return api.prepareCoinPort(coin, confName, fallbackPort);
        })
        .then(() => {
          port = api.assetChainPorts[coin];
          return api.checkPort(port);
        })
        .then(async (status) => {
          if (status === "AVAILABLE") {
            const suppliedAcOptions =
              typeof requestedAcOptions === "function"
                ? requestedAcOptions()
                : requestedAcOptions;
            const acOptions = validateStartupOptions(suppliedAcOptions, coin);

            if (customDataDirOption != null) {
              acOptions.push(customDataDirOption);
            }
            if (
              !coinDirExisted &&
              !hasStartupOption(acOptions, "bootstrap") &&
              (await canFetchBootstrap(coin))
            ) {
              acOptions.push("-bootstrap");
            }
            if (
              daemon === "verusd" &&
              !api.appConfig.coin.native.noFastLoad[coin] &&
              !hasStartupOption(acOptions, "fastload")
            ) {
              acOptions.push("-fastload");
            }

            api.log(
              `selected data: ${JSON.stringify(acOptions, null, "\t")}`,
              "native.confd"
            );
            api.log(
              `port ${port} available, starting daemon...`,
              "native.process"
            );
            api.startedDaemonRegistry[coin] = true;

            api.spawnDaemonChild(daemon, coin, acOptions);
            resolve();
          } else {
            api.log(
              `port ${port} not available, assuming coin has already been started...`,
              "native.process"
            );

            resolve();
          }
        })
        .catch((err) => reject(err));
    });
  };

  api.getAssetChainPorts = () => {
    return api.assetChainPorts;
  }

  return api;
};
