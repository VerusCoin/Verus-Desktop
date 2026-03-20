const spawn = require('child_process').spawn;
const fs = require('fs-extra');
const _fs = require('graceful-fs');
const fsnode = require('fs');
const path = require('path');
const os = require('os');
const portscanner = require('portscanner');
const execFile = require('child_process').execFile;
const md5 = require('agama-wallet-lib/src/crypto/md5');

module.exports = (api) => {
  // const getConf = (flock, coind) => {
  //   const _platform = os.platform();
  //   let DaemonConfPath = '';
  //   let pbaasCoinDir;

  //   if (flock === 'CHIPS') {
  //     flock = 'chipsd';
  //   }

  //   api.log(flock, 'native.confd');
  //   api.log(`getconf coind ${coind}`, 'native.confd');
  //   api.writeLog(`getconf flock: ${flock}`, 'native.confd');

  //   //If the coin uses verusd as it's daemon and isn't Verus, we assume it's
  //   //directory will lie in PBaaS territory, outside of the kmdDataDir
  //   if (api.appConfig.general.main.reservedChains.indexOf(flock) === -1) {
  //     if (api.appConfig.general.main.pbaasTestmode) {
  //       pbaasCoinDir = path.normalize(path.join(api.paths.verusTestDir, `/PBAAS/${flock}`));
  //       api.log(`Assuming PBAAS chain in test mode, using conf path as ${pbaasCoinDir}`, 'native.confd');
  //     } else {
  //       pbaasCoinDir = path.normalize(path.join(api.paths.verusDir, `/PBAAS/${flock}`));
  //       api.log(`Assuming PBAAS chain, using conf path as ${pbaasCoinDir}`, 'native.confd');
  //     }

  //     return pbaasCoinDir;
  //   }

  //   switch (flock) {
  //     case 'komodod':
  //       DaemonConfPath = api.paths.kmdDataDir;
  //       if (_platform === 'win32') {
  //         DaemonConfPath = path.normalize(DaemonConfPath);
  //         api.log('===>>> API OUTPUT ===>>>', 'native.confd');
  //       }
  //       break;
  //     case 'zcashd':
  //       DaemonConfPath = api.ZcashDir;
  //       if (_platform === 'win32') {
  //         DaemonConfPath = path.normalize(DaemonConfPath);
  //       }
  //       break;
  //     case 'chipsd':
  //       DaemonConfPath = api.paths.chipsDir;
  //       if (_platform === 'win32') {
  //         DaemonConfPath = path.normalize(DaemonConfPath);
  //       }
  //       break;
  //     //TODO: Delete, Deprecated
  //     //case 'coind':
  //     //  DaemonConfPath = _platform === 'win32' ? path.normalize(`${api.coindRootDir}/${coind.toLowerCase()}`) : `${api.coindRootDir}/${coind.toLowerCase()}`;
  //     //  break;
  //     default:
  //       DaemonConfPath = `${api.paths.kmdDataDir}/${flock}`;
  //       if (_platform === 'win32') {
  //         DaemonConfPath = path.normalize(DaemonConfPath);
  //       }
  //   }

  //   api.writeLog(`getconf path: ${DaemonConfPath}`);
  //   api.log(`daemon path: ${DaemonConfPath}`, 'native.confd');

  //   return DaemonConfPath;
  // }

  // const setConf = (flock, coind) => {
  //   const _platform = os.platform();
  //   let nativeCoindDir;
  //   let DaemonConfPath;

  //   api.log(flock, 'native.confd');
  //   api.writeLog(`setconf ${flock}`);

  //   switch (_platform) {
  //     case 'darwin':
  //       nativeCoindDir = coind ? `${process.env.HOME}/Library/Application Support/${api.nativeCoindList[coind.toLowerCase()].bin}` : null;
  //       break;
  //     case 'linux':
  //       nativeCoindDir = coind ? `${process.env.HOME}/.${api.nativeCoindList[coind.toLowerCase()].bin.toLowerCase()}` : null;
  //       break;
  //     case 'win32':
  //       nativeCoindDir = coind ?  `${process.env.APPDATA}/${api.nativeCoindList[coind.toLowerCase()].bin}` : null;
  //       break;
  //   }

  //   switch (flock) {
  //     case 'verusd':
  //       if (coind && api.appConfig.general.main.reservedChains.indexOf(coind) === -1) {
  //         DaemonConfPath = `${api.paths.verusDir}/PBAAS/${coind}.conf`;
  //       } else {
  //         DaemonConfPath = `${api.paths.vrscDataDir}/VRSC.conf`;
  //       }
        

  //       if (_platform === 'win32') {
  //         DaemonConfPath = path.normalize(DaemonConfPath);
  //       }
  //       break;
  //     case 'komodod':
  //       DaemonConfPath = `${api.paths.kmdDataDir}/komodo.conf`;

  //       if (_platform === 'win32') {
  //         DaemonConfPath = path.normalize(DaemonConfPath);
  //       }
  //       break;
  //     case 'zcashd':
  //       DaemonConfPath = `${api.ZcashDir}/zcash.conf`;

  //       if (_platform === 'win32') {
  //         DaemonConfPath = path.normalize(DaemonConfPath);
  //       }
  //       break;
  //     case 'chipsd':
  //       DaemonConfPath = `${api.paths.chipsDir}/chips.conf`;

  //       if (_platform === 'win32') {
  //         DaemonConfPath = path.normalize(DaemonConfPath);
  //       }
  //       break;
  //     case 'coind':
  //       DaemonConfPath = `${nativeCoindDir}/${api.nativeCoindList[coind.toLowerCase()].bin.toLowerCase()}.conf`;

  //       if (_platform === 'win32') {
  //         DaemonConfPath = path.normalize(DaemonConfPath);
  //       }
  //       break;
  //     default:
  //       DaemonConfPath = `${api.paths.kmdDataDir}/${flock}/${flock}.conf`;

  //       if (_platform === 'win32') {
  //         DaemonConfPath = path.normalize(DaemonConfPath);
  //       }
  //   }

  //   api.log(DaemonConfPath, 'native.confd');
  //   api.writeLog(`setconf ${DaemonConfPath}`);

  //   const CheckFileExists = () => {
  //     return new Promise((resolve, reject) => {
  //       const result = 'Check Conf file exists is done';
  //       const confFileExist = fs.ensureFileSync(DaemonConfPath);

  //       if (confFileExist) {
  //         api.log(result, 'native.confd');
  //         api.writeLog(`setconf ${result}`);

  //         resolve(result);
  //       } else {
  //         api.log('conf file doesnt exist', 'native.confd');
  //         resolve('conf file doesnt exist');
  //       }
  //     });
  //   }

  //   const FixFilePermissions = () => {
  //     return new Promise((resolve, reject) => {
  //       const result = 'Conf file permissions updated to Read/Write';

  //       fsnode.chmodSync(DaemonConfPath, '0600');
  //       api.log(result, 'native.confd');
  //       api.writeLog(`setconf ${result}`);

  //       resolve(result);
  //     });
  //   }

  //   const RemoveLines = () => {
  //     return new Promise((resolve, reject) => {
  //       const result = 'RemoveLines is done';

  //       fs.readFile(DaemonConfPath, 'utf8', (err, data) => {
  //         if (err) {
  //           api.writeLog(`setconf error ${err}`);
  //           return api.log(err);
  //         }

  //         const rmlines = data.replace(/(?:(?:\r\n|\r|\n)\s*){2}/gm, '\n');

  //         fs.writeFile(DaemonConfPath, rmlines, 'utf8', (err) => {
  //           if (err)
  //             return api.log(err);

  //           fsnode.chmodSync(DaemonConfPath, '0600');
  //           api.writeLog(`setconf ${result}`, 'native.confd');
  //           api.log(result);
  //           resolve(result);
  //         });
  //       });
  //     });
  //   }

  //   const CheckConf = () => {
  //     return new Promise((resolve, reject) => {
  //       const result = 'CheckConf is done';

  //       api.setconf.status(DaemonConfPath, (err, status) => {
  //         const rpcuser = () => {
  //           return new Promise((resolve, reject) => {
  //             const result = 'checking rpcuser...';

  //             if (status[0].hasOwnProperty('rpcuser')) {
  //               api.log('rpcuser: OK', 'native.confd');
  //               api.writeLog('rpcuser: OK');
  //             } else {
  //               const randomstring = md5((Math.random() * Math.random() * 999).toString());

  //               api.log('rpcuser: NOT FOUND', 'native.confd');
  //               api.writeLog('rpcuser: NOT FOUND');

  //               fs.appendFile(DaemonConfPath, `\nrpcuser=user${randomstring.substring(0, 16)}`, (err) => {
  //                 if (err) {
  //                   api.writeLog(`append daemon conf err: ${err}`);
  //                   api.log(`append daemon conf err: ${err}`, 'native.confd');
  //                 }
  //                 // throw err;
  //                 api.log('rpcuser: ADDED', 'native.confd');
  //                 api.writeLog('rpcuser: ADDED');
  //               });
  //             }

  //             resolve(result);
  //           });
  //         }

  //         const rpcpass = () => {
  //           return new Promise((resolve, reject) => {
  //             const result = 'checking rpcpassword...';

  //             if (status[0].hasOwnProperty('rpcpassword')) {
  //               api.log('rpcpassword: OK', 'native.confd');
  //               api.writeLog('rpcpassword: OK');
  //             } else {
  //               const randomstring = md5((Math.random() * Math.random() * 999).toString());

  //               api.log('rpcpassword: NOT FOUND');
  //               api.writeLog('rpcpassword: NOT FOUND');

  //               fs.appendFile(DaemonConfPath, `\nrpcpassword=${randomstring}`, (err) => {
  //                 if (err) {
  //                   api.writeLog(`append daemon conf err: ${err}`);
  //                   api.log(`append daemon conf err: ${err}`, 'native.confd');
  //                 }
  //                 api.log('rpcpassword: ADDED', 'native.confd');
  //                 api.writeLog('rpcpassword: ADDED');
  //               });
  //             }

  //             resolve(result);
  //           });
  //         }

  //         const rpcport = () => {
  //           return new Promise((resolve, reject) => {
  //             const result = 'checking rpcport...';

  //             if (flock === 'komodod') {
  //               if (status[0].hasOwnProperty('rpcport')) {
  //                 api.log('rpcport: OK', 'native.confd');
  //                 api.writeLog('rpcport: OK');
  //               } else {
  //                 api.log('rpcport: NOT FOUND', 'native.confd');
  //                 api.writeLog('rpcport: NOT FOUND');

  //                 fs.appendFile(DaemonConfPath, '\nrpcport=7771', (err) => {
  //                   if (err) {
  //                     api.writeLog(`append daemon conf err: ${err}`);
  //                     api.log(`append daemon conf err: ${err}`, 'native.confd');
  //                   }
  //                   api.log('rpcport: ADDED', 'native.confd');
  //                   api.writeLog('rpcport: ADDED');
  //                 });
  //               }
  //             }

  //             resolve(result);
  //           });
  //         }

  //         const server = () => {
  //           return new Promise((resolve, reject) => {
  //             const result = 'checking server...';

  //             if (status[0].hasOwnProperty('server')) {
  //               api.log('server: OK', 'native.confd');
  //               api.writeLog('server: OK');
  //             } else {
  //               api.log('server: NOT FOUND');
  //               api.writeLog('server: NOT FOUND');

  //               fs.appendFile(DaemonConfPath, '\nserver=1', (err) => {
  //                 if (err) {
  //                   api.writeLog(`append daemon conf err: ${err}`, 'native.confd');
  //                   api.log(`append daemon conf err: ${err}`);
  //                 }
  //                 // throw err;
  //                 api.log('server: ADDED', 'native.confd');
  //                 api.writeLog('server: ADDED');
  //               });
  //             }

  //             resolve(result);
  //           });
  //         }

  //         const addnode = () => {
  //           return new Promise((resolve, reject) => {
  //             const result = 'checking addnode...';

  //             if (flock === 'chipsd' ||
  //                 flock === 'komodod') {
  //               if (status[0].hasOwnProperty('addnode')) {
  //                 api.log('addnode: OK', 'native.confd');
  //                 api.writeLog('addnode: OK');
  //               } else {
  //                 let nodesList;

  //                 if (flock === 'chipsd') {
  //                   nodesList = '\naddnode=95.110.191.193' +
  //                   '\naddnode=144.76.167.66' +
  //                   '\naddnode=158.69.248.93' +
  //                   '\naddnode=149.202.49.218' +
  //                   '\naddnode=95.213.205.222' +
  //                   '\naddnode=5.9.253.198' +
  //                   '\naddnode=164.132.224.253' +
  //                   '\naddnode=163.172.4.66' +
  //                   '\naddnode=217.182.194.216' +
  //                   '\naddnode=94.130.96.114' +
  //                   '\naddnode=5.9.253.195';
  //                 } else if (flock === 'komodod') {
  //                   nodesList = '\naddnode=78.47.196.146' +
  //                   '\naddnode=5.9.102.210' +
  //                   '\naddnode=178.63.69.164' +
  //                   '\naddnode=88.198.65.74' +
  //                   '\naddnode=5.9.122.241' +
  //                   '\naddnode=144.76.94.3';
  //                 }

  //                 api.log('addnode: NOT FOUND', 'native.confd');
  //                 fs.appendFile(DaemonConfPath, nodesList, (err) => {
  //                   if (err) {
  //                     api.writeLog(`append daemon conf err: ${err}`);
  //                     api.log(`append daemon conf err: ${err}`, 'native.confd');
  //                   }
  //                   api.log('addnode: ADDED', 'native.confd');
  //                   api.writeLog('addnode: ADDED');
  //                 });
  //               }
  //             } else {
  //               result = 'skip addnode';
  //             }

  //             resolve(result);
  //           });
  //         }

  //         rpcuser()
  //         .then((result) => {
  //           return rpcpass();
  //         })
  //         .then(server)
  //         .then(rpcport)
  //         .then(addnode);
  //       });

  //       api.log(result, 'native.confd');
  //       api.writeLog(`checkconf addnode ${result}`);

  //       resolve(result);
  //     });
  //   }

  //   CheckFileExists()
  //   .then((result) => {
  //     return FixFilePermissions();
  //   })
  //   .then(RemoveLines)
  //   .then(CheckConf);
  // }

  // /*
  //  *  type: POST
  //  */
  // api.setPost('/setconf', (req, res) => {
  //   const _body = req.body;

  //   api.log('setconf req.body =>', 'native.confd');
  //   api.log(_body, 'native.confd');

  //   if (os.platform() === 'win32' &&
  //       _body.chain == 'komodod') {
  //     setkomodoconf = spawn(path.join(__dirname, '../assets/bin/win64/genkmdconf.bat'));
  //   } else {
  //     api.setConf(_body.chain);
  //   }

  //   const retObj = {
  //     msg: 'success',
  //     result: 'result',
  //   };

  //   res.send(JSON.stringify(retObj));
  // });

  // /*
  //  *  type: POST
  //  */
  // api.setPost('/getconf', (req, res) => {
  //   const _body = req.body;

  //   api.log('getconf req.body =>', 'native.confd');
  //   api.log(_body, 'native.confd');

  //   const confpath = getConf(_body.chain, _body.coind);

  //   api.log(`getconf path is: ${confpath}`, 'native.confd');
  //   api.writeLog(`getconf path is: ${confpath}`, 'native.confd');

  //   const retObj = {
  //     msg: 'success',
  //     result: confpath,
  //   };

  //   res.send(JSON.stringify(retObj));
  // });

  // api.setConfKMD = (isChips) => {
  //   // check if kmd conf exists
  //   _fs.access(isChips ? `${api.paths.chipsDir}/chips.conf` : `${api.paths.kmdDataDir}/komodo.conf`, fs.constants.R_OK, (err) => {
  //     if (err) {
  //       api.log(isChips ? 'creating chips conf' : 'creating komodo conf', 'native.confd');
  //       api.writeLog(isChips ? `creating chips conf in ${api.paths.chipsDir}/chips.conf` : `creating komodo conf in ${api.paths.kmdDataDir}/komodo.conf`);
  //       setConf(isChips ? 'chipsd' : 'komodod');
  //     } else {
  //       const _confSize = fs.lstatSync(isChips ? `${api.paths.chipsDir}/chips.conf` : `${api.paths.kmdDataDir}/komodo.conf`);

  //       if (_confSize.size === 0) {
  //         api.log(isChips ? 'err: chips conf file is empty, creating chips conf' : 'err: komodo conf file is empty, creating komodo conf', 'native.confd');
  //         api.writeLog(isChips ? `creating chips conf in ${api.paths.chipsDir}/chips.conf` : `creating komodo conf in ${api.paths.kmdDataDir}/komodo.conf`);
  //         setConf(isChips ? 'chipsd' : 'komodod');
  //       } else {
  //         api.writeLog(isChips ? 'chips conf exists' : 'komodo conf exists');
  //         api.log(isChips ? 'chips conf exists' : 'komodo conf exists', 'native.confd');
  //       }
  //     }
  //   });
  // }

  // api.getAssetChainPorts = () => {
  //   return api.assetChainPorts;
  // }

  return api;
};