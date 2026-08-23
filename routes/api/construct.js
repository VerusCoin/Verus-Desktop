const { BuiltinPlugins } = require('./utils/plugin/builtin.js');

module.exports = (api) => {
  api.construct = function () {
    api.appConfig = api._appConfig.config;
    api.pathsAgama();
    api.pathsDaemons();

    api.initMainCache();

    api.firstRun = api.createAgamaDirs();
    api.appConfig = api.loadLocalConfig();
    api.plugins = {
      registry: api.loadLocalPluginRegistry(),
      builtin: BuiltinPlugins,
    };

    api.appConfigSchema = api._appConfig.schema;
    // Reset means the shipped defaults, not a shallow alias of the user's
    // startup configuration. A shallow copy could retain a disabled security
    // setting and later re-disable it without passing through /config/save.
    api.defaultAppConfig = JSON.parse(JSON.stringify(api._appConfig.config));
    api.kmdMainPassiveMode = false;

    api.native.cache.currency_definition_cache = api.create_sub_cache(
      "native.cache.currency_definition_cache"
    );

    api.seed = null;

    // init electrum connection manager loop
    api.initElectrumManager();

    api.printDirs();

    // default route
    api.setGet("/", (req, res, next) => {
      res.send("Agama app server2");
    });

    // expose sockets obj
    api.setIO = (io) => {
      api.io = io;
    };

    api.setVar = (_name, _body) => {
      api[_name] = _body;
    };

    if (api.appConfig.general.electrum && api.appConfig.general.electrum.customServers) {
      api.loadElectrumServersList();
    } else {
      api.mergeLocalKvElectrumServers();
    }

    api.checkCoinConfigIntegrity();
  };

  return api;
};
