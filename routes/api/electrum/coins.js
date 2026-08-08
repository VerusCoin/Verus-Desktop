const { getRandomIntInclusive } = require('agama-wallet-lib/src/utils');
const { dialog } = require("electron");
const { validateElectrumServerList } = require("./serverValidation");

module.exports = (api) => {
  api.findCoinName = (network) => {
    for (let key in api.electrumServers) {
      if (key.toLowerCase() === network.toLowerCase()) {
        return key;
      }
    }
  }

  api.addElectrumCoin = async(coin, customServers = [], tags = [], txFee) => {
    if (typeof coin !== "string" || !/^[0-9a-z._-]{1,64}$/i.test(coin)) {
      throw new Error("Invalid Electrum coin ticker");
    }
    if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string" || !/^[0-9a-z_-]{1,64}$/i.test(tag))) {
      throw new Error("Invalid Electrum coin tags");
    }
    coin = coin.toLowerCase();
    const allowTcp = api.appConfig.general.electrum.allowInsecureTcp === true;
    
    if (customServers.length > 0) {
      customServers = validateElectrumServerList(customServers, { allowTcp });
      if (txFee == null || !Number.isFinite(Number(txFee)) || Number(txFee) < 0 || Number(txFee) > 1e9) {
        throw new Error("Invalid Electrum transaction fee");
      }
    }

    if (customServers.length > 0 && api.electrumServers[coin] == null) {
      api.electrumServers[coin] = {
        serverList: customServers,
        txfee: Number(txFee)
      }
    }

    if (tags.includes('is_komodo')) api.customKomodoNetworks[coin] = true

    // select random server
    let randomServer;
    let servers = api.electrumServers[coin] ? api.electrumServers[coin].serverList : []
    servers = validateElectrumServerList(servers, {
      allowTcp,
      filterTcp: !allowTcp,
    });
    
    // pick a random server to communicate with
    if (servers &&
        servers.length > 0) {
      const _randomServerId = getRandomIntInclusive(0, servers.length - 1);
      const _randomServer = servers[_randomServerId];
      const _serverDetails = _randomServer.split(':');

      if (_serverDetails.length === 3) {
        randomServer = {
          ip: _serverDetails[0],
          port: _serverDetails[1],
          proto: _serverDetails[2],
        };
      }
    }
    
    if (!randomServer) throw new Error("No valid Electrum server is available");

    api.electrum.coinData[coin] = {
      name: coin,
      server: {
        ip: randomServer.ip,
        port: randomServer.port,
        proto: randomServer.proto,
      },
      serverList: servers ? servers : 'none',
      txfee: coin === 'btc' ? 'calculated' : api.electrumServers[coin] ? api.electrumServers[coin].txfee : 0,
    };

    // wait for spv connection to be established
    await api.ecl(coin);

    if (Object.keys(api.electrumKeys).length > 0) {
      const _keys = api.wifToWif(
        api.electrumKeys[Object.keys(api.electrumKeys)[0]].priv,
        coin
      );

      api.electrumKeys[coin] = {
        priv: _keys.priv,
        pub: _keys.pub,
      };
    } else if (api.seed) {
      api.auth(api.seed, true);
    }

    return true;
  }

  api.setPost('/electrum/coins/activate', async(req, res, next) => {
    try {
      const { chainTicker, launchConfig } = req.body
      if (!launchConfig || typeof launchConfig !== "object") {
        throw new Error("Missing Electrum launch configuration");
      }
      const { customServers = [], tags = [], txFee } = launchConfig

      if (customServers.length > 0) {
        validateElectrumServerList(customServers, {
          allowTcp: api.appConfig.general.electrum.allowInsecureTcp === true,
        });
        const confirmation = await dialog.showMessageBox({
          type: "warning",
          title: "Use Custom Electrum Servers?",
          message: `Use caller-supplied Electrum servers for ${chainTicker}? These servers can observe wallet addresses and provide untrusted chain data.`,
          buttons: ["Cancel", "Use Servers"],
          defaultId: 0,
          cancelId: 0,
        });
        if (confirmation.response !== 1) throw new Error("Custom Electrum server activation cancelled");
      }

      const result = await api.addElectrumCoin(chainTicker, customServers, tags, txFee);
      res.send(JSON.stringify({ msg: 'success', result }));
    } catch (e) {
      res.send(JSON.stringify({ msg: "error", result: e.message }));
    }
  }, true);

  api.checkCoinConfigIntegrity = (coin) => {
    let _totalCoins = 0;

    for (let key in api.electrumJSNetworks) {
      if (!api.electrumServers[key] ||
          (api.electrumServers[key] && !api.electrumServers[key].serverList)) {
        delete api.electrumServers[key];
      } else {
        _totalCoins++;
      }
    }
  };

  return api;
};
