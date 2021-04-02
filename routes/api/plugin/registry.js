const fs = require('fs-extra');
const _fs = require('graceful-fs');
const fsnode = require('fs');
const path = require('path')

module.exports = (api) => {
  api.loadLocalPluginRegistry = () => {
    const registryLocation = `${api.paths.agamaDir}/plugins.json`

    if (fs.existsSync(registryLocation)) {
      try {
        return JSON.parse(fs.readFileSync(registryLocation, 'utf8'))
      } catch(e) {
        api.log('Unable to load local plugins.json, error with following message:', 'plugins');
        api.log(e.message, 'plugins');
      }
    }

    api.saveLocalPluginRegistry({});
    return {}
  };

  api.saveLocalPluginRegistry = (plugins) => {
    const registryLocation = `${api.paths.agamaDir}/plugins.json`;

    try {
      try {
        _fs.accessSync(api.paths.agamaDir, fs.constants.R_OK)
      } catch (e) {
        if (e.code == 'EACCES') {
          fsnode.chmodSync(registryLocation, '0666');
        } else if (e.code === 'ENOENT') {
          api.log('plugins directory not found', 'plugins');
        }
      }

      fs.writeFileSync(registryLocation, JSON.stringify(plugins, null, 2), 'utf8');

      api.log('plugins.json write file is done', 'plugins');
      api.log(`app plugins.json file is created successfully at: ${api.paths.agamaDir}`, 'plugins');
      api.writeLog(`app plugins.json file is created successfully at: ${api.paths.agamaDir}`);
    } catch (e) {
      api.log('error writing plugins', 'plugins');
      api.log(e, 'plugins');
      throw e;
    }
  }

  api.getPlugin = async (id, builtin = false) => {
    const category = builtin ? 'builtin' : 'registry'

    try {
      if (!api.plugins[category] || !api.plugins[category][id]) {
        throw new Error(
          `plugin with id ${id} does not exist in category ${category} or plugins are not loaded`
        );
      }
        
      return {
        ...api.plugins[category][id],
        logo: builtin ? null : path.join(api.plugins[category][id].path, "logo.png"),
        index: api.plugins[category][id].path == null ? null : path.join(api.plugins[category][id].path, "plugin", "index.html"),
        info: builtin ? null : JSON.parse(await fs.readFile(path.join(api.plugins[category][id].path, "info.txt"), 'utf8'))
      }
    } catch(e) {
      throw e
    }
  }

  api.setGet('/plugin/all', (req, res, next) => {
    if (api.plugins) {
      res.send(JSON.stringify({
        msg: 'success',
        result: api.plugins,
      }));
    } else {
      res.send(JSON.stringify({
        msg: 'error',
        result: "plugin list not loaded",
      }));
    }
  });

  api.setGet('/plugin/get', async (req, res, next) => {
    const { id, search_builtin } = req.query
    const category = search_builtin === 'true' || search_builtin === true ? 'builtin' : 'registry'

    if (api.plugins[category]) {
      if (api.plugins[category][id]) {
        try {
          res.send(JSON.stringify({
            msg: 'success',
            result: await api.getPlugin(id, category === 'builtin'),
          }));
        } catch(e) {
          res.send(JSON.stringify({
            msg: 'error',
            result: e.message,
          }));
        }
        
      } else {
        res.send(JSON.stringify({
          msg: 'error',
          result: `plugin with id ${id} not found`,
        }));
      }
    } else {
      res.send(JSON.stringify({
        msg: 'error',
        result: "plugin list not loaded",
      }));
    }
  });

  return api;
};