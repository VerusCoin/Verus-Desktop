const { checkTimestamp } = require('agama-wallet-lib/src/time');
const { getRandomIntInclusive } = require('agama-wallet-lib/src/utils');

const CHECK_INTERVAL = 1000;
const MAX_IDLE_TIME = 5 * 60;
const PING_TIME = 60;

// TODO: reconnect/cycle if electrum server is not responding

let electrumServers = {};

const getProtocolVersion = async (_ecl, api) => {
  let protocolVersion;
  const serverData = await _ecl.serverVersion('VerusDesktop');

  if (Array.isArray(serverData) &&
      typeof serverData[0] === "string" &&
      serverData[0].indexOf('ElectrumX') > -1 &&
      Number(serverData[1])) {
    protocolVersion = Number(serverData[1]);
    _ecl.setProtocolVersion(protocolVersion.toString());
  }

  if (process.argv.indexOf('spv-debug') > -1) {
    api.log(
      `ecl ${`${_ecl.host}:${_ecl.port}:${_ecl.protocol || 'tcp'}`} protocol version: ${protocolVersion}`,
      'ecl.manager'
    );
  }
  return protocolVersion;
};

module.exports = (api) => {
  api.eclStack = [];

  api.eclManagerClear = (coin) => {
    if (coin) delete electrumServers[coin];
    electrumServers = {};
  };

  api.eclManager = {
    getServer: async(coin, customServer) => {
      if (electrumServers[coin]) {
        for (const serverKey of Object.keys(electrumServers[coin])) {
          const managedServer = electrumServers[coin][serverKey];
          if (!managedServer.server || managedServer.server.status !== 2) {
            if (managedServer.server) managedServer.server.close();
            delete electrumServers[coin][serverKey];
          }
        }
      }

      if (customServer && process.argv.indexOf('spv-debug') > -1) api.log(`custom server ${customServer.ip}:${customServer.port}:${customServer.proto}`, 'ecl.manager');
      if ((customServer && (!electrumServers[coin] || !electrumServers[coin][`${customServer.ip}:${customServer.port}:${customServer.proto}`])) ||
          !electrumServers[coin] ||
          (electrumServers[coin] && !Object.keys(electrumServers[coin]).length)) {
        let serverStr = '';

        if (!customServer) {
          serverStr = [
            api.electrum.coinData[coin].server.ip,
            api.electrum.coinData[coin].server.port,
            api.electrum.coinData[coin].server.proto
          ];
        } else {
          serverStr = [
            customServer.ip,
            customServer.port,
            customServer.proto
          ];
        }

        if (process.argv.indexOf('spv-debug') > -1) api.log('ecl server doesnt exist yet, lets add', 'ecl.manager')

        const ecl = new api.electrumJSCore(
          serverStr[1],
          serverStr[0],
          serverStr[2],
          api.appConfig.general.electrum.socketTimeout
        );
        if (process.argv.indexOf('spv-debug') > -1) api.log(`ecl conn ${serverStr}`, 'ecl.manager');
        try {
          await ecl.connect();
          if (process.argv.indexOf('spv-debug') > -1) api.log(`ecl req protocol ${serverStr}`, 'ecl.manager');
          await getProtocolVersion(ecl, api);
        } catch (e) {
          ecl.close();
          throw e;
        }
        
        if (!electrumServers[coin]) {
          electrumServers[coin] = {};
        }

        electrumServers[coin][serverStr.join(':')] = {
          server: ecl,
          lastReq: Date.now(),
          lastPing: Date.now(),
          pinging: false,
        };

        return electrumServers[coin][serverStr.join(':')].server;
      } else {
        if (customServer) {
          if (process.argv.indexOf('spv-debug') > -1) api.log(`ecl ${coin} server exists, custom server param provided`, 'ecl.manager');
          let ecl = electrumServers[coin][`${customServer.ip}:${customServer.port}:${customServer.proto}`];
          ecl.lastReq = Date.now();
          return ecl.server;
        } else {
          if (process.argv.indexOf('spv-debug') > -1) api.log(`ecl ${coin} server exists`, 'ecl.manager');
          const serverKeys = Object.keys(electrumServers[coin]);
          let ecl = serverKeys.length > 1
            ? electrumServers[coin][serverKeys[getRandomIntInclusive(0, serverKeys.length - 1)]]
            : electrumServers[coin][serverKeys[0]];
          ecl.lastReq = Date.now();
          return ecl.server;
        }
      }
    }
  };

  api.initElectrumManager = () => {
    setInterval(() => {
      for (let coin in electrumServers) {
        if (process.argv.indexOf('spv-debug') > -1) api.log(`ecl check coin ${coin}`, 'ecl.manager');

        for (let serverStr in electrumServers[coin]) {
          const managedServer = electrumServers[coin][serverStr];
          const pingSecPassed = checkTimestamp(managedServer.lastPing);
          if (process.argv.indexOf('spv-debug') > -1) api.log(`ping sec passed ${pingSecPassed}`, 'ecl.manager');
          
          if (pingSecPassed > PING_TIME && !managedServer.pinging) {
            if (process.argv.indexOf('spv-debug') > -1) api.log(`ecl ${coin} ${serverStr} ping limit passed, send ping`, 'ecl.manager');

            managedServer.pinging = true;
            managedServer.server.serverPing()
            .then(() => {
              if (electrumServers[coin] && electrumServers[coin][serverStr] === managedServer) {
                managedServer.lastPing = Date.now();
                managedServer.pinging = false;
              }
              if (process.argv.indexOf('spv-debug') > -1) api.log(`ecl ${coin} ${serverStr} ping success`, 'ecl.manager');
            })
            .catch((error) => {
              api.log(`ecl ${coin} ${serverStr} ping failed: ${error.message}`, 'ecl.manager');
              managedServer.server.close();
              if (electrumServers[coin] && electrumServers[coin][serverStr] === managedServer) {
                delete electrumServers[coin][serverStr];
              }
            });
          }

          const reqSecPassed = checkTimestamp(managedServer.lastReq);
          if (process.argv.indexOf('spv-debug') > -1) api.log(`req sec passed ${reqSecPassed}`, 'ecl.manager');
          
          if (reqSecPassed > MAX_IDLE_TIME) {
            if (process.argv.indexOf('spv-debug') > -1) api.log(`ecl ${coin} ${serverStr} req limit passed, disconnect server`, 'ecl.manager');
            managedServer.server.close();
            delete electrumServers[coin][serverStr];
          }
        }
      }

      //api.checkOpenElectrumConnections();
    }, CHECK_INTERVAL);
  };

  return api;
};
