const fs = require('fs-extra');
const _fs = require('graceful-fs');
const fsnode = require('fs');
const defaultConf = require('../appConfig.js').config;
const {
  addMerge,
  flattenObjectProps,
  removeElementByProperties,
  useStringAsKey
} = require("./utils/objectUtil/objectUtil.js");

module.exports = (api) => {
  api.loadLocalConfig = () => {
    const configLocation = `${api.paths.agamaDir}/config.json`

    if (fs.existsSync(configLocation)) {
      try {
        let configChanged = false

        let localAppConfig = JSON.parse(fs.readFileSync(configLocation, 'utf8'))

        api.log('Local app config read successfully, checking diffs...', 'settings');

        const flatLocal = flattenObjectProps(localAppConfig)
        const flatDefault = flattenObjectProps(defaultConf)
        
        const localUnecessary = flatLocal.filter(x => {return !flatDefault.includes(x)})

        if (localUnecessary.length > 0) {
          api.log('The local config has the following unecessary properties, deleting them now...', 'settings');
          api.log(localUnecessary, 'settings');

          localUnecessary.forEach(propertyGroup => {
            if (useStringAsKey(localAppConfig, propertyGroup) != null) {
              const propertyArray = propertyGroup.split('.')
              localAppConfig = removeElementByProperties(localAppConfig, propertyArray)

              api.log(`Removed ${propertyGroup} successfully...`, 'settings');
            }
          })

          configChanged = true
          api.log(`Done removing unecessary properties from local config.`, 'settings');
        }

        const localMissing = flatDefault.filter(x => {return !flatLocal.includes(x)})

        if (localMissing.length > 0) {
          api.log('The local config is missing the following properties! Attempting to add them in now...', 'settings');
          api.log(localMissing, 'settings');

          localMissing.forEach(propertyGroup => {
            if (useStringAsKey(localAppConfig, propertyGroup) == null) {
              localAppConfig = addMerge(localAppConfig, defaultConf)

              api.log(`Added ${propertyGroup} successfully...`, 'settings');
            }
          })

          configChanged = true
          api.log(`Done adding missing necessary properties to local config.`, 'settings');
        }

        api.log(`Done checking local config diffs.`, 'settings');

        if (configChanged) {
          api.log(`Diffs found and config updated, saving new config...`, 'settings');
          api.saveLocalAppConf(localAppConfig);
        } else {
          api.log(`No diffs found.`, 'settings');
        }
        
        return localAppConfig

      } catch(e) {
        api.log('Unable to load local config.json, error with following message:', 'settings');
        api.log(e.message, 'settings');
      }
    }

    api.log('Setting config to default...', 'settings');
    api.saveLocalAppConf(defaultConf);
    return defaultConf
  };

  api.saveLocalAppConf = (appSettings) => {
    const configFileName = `${api.paths.agamaDir}/config.json`;

    try {
      try {
        _fs.accessSync(api.paths.agamaDir, fs.constants.R_OK)
      } catch (e) {
        if (e.code == 'EACCES') {
          fsnode.chmodSync(configFileName, '0600');
        } else if (e.code === 'ENOENT') {
          api.log('config directory not found', 'settings');
        }
      }

      fs.writeFileSync(configFileName, JSON.stringify(appSettings, null, 2), 'utf8');

      api.log('config.json write file is done', 'settings');
      api.log(`app config.json file is created successfully at: ${api.paths.agamaDir}`, 'settings');
    } catch (e) {
      api.log('error writing config', 'settings');
      api.log(e, 'settings');
      throw e;
    }
  }

  api.agreeToTerms = () => {
    const config = api.appConfig 
    
    return api.saveLocalAppConf({
      ...config,
      general: {
        ...config.general,
        main: {
          ...config.general.main,
          agreedToTerms: true,
        },
      },
    });
  }

  /*
   *  type: POST
   *  params: configObj
   */
  api.setPost('/config/save', (req, res, next) => {
    if (!req.body.configObj) {
      const retObj = {
        msg: 'error',
        result: 'no configObj provided',
      };

      res.send(JSON.stringify(retObj));
    } else {
      try {
        api.saveLocalAppConf(req.body.configObj);
      } catch(e) {
        res.send(JSON.stringify({
          msg: 'error',
          result: e.message,
        }));
        return
      }

      res.send(JSON.stringify({
        msg: 'success',
        result: 'config saved',
      }));
    }
  });

  /*
   *  type: POST
   *  params: none
   */
  api.setPost('/config/reset', (req, res, next) => {
    api.saveLocalAppConf(api.defaultAppConfig);

    const retObj = {
      msg: 'success',
      result: 'config saved',
    };

    res.send(JSON.stringify(retObj));
  });

  /*
   *  type: GET
   *
   */
  api.setGet('/config/load', (req, res, next) => {
    const retObj = {
      msg: 'success',
      result: api.loadLocalConfig(),
    };

    res.send(JSON.stringify(retObj));
  });

  /*
   *  type: GET
   *
   */
  api.setGet('/config/schema', (req, res, next) => {
    const retObj = {
      msg: 'success',
      result: api.appConfigSchema,
    };

    res.send(JSON.stringify(retObj));
  });

  api.testLocation = (path) => {
    return new Promise((resolve, reject) => {
      fs.lstat(path, (err, stats) => {
        if (err) {
          api.log(`error testing path ${path}`, 'settings');
          resolve(-1);
        } else {
          if (stats.isDirectory()) {
            resolve(true);
          } else {
            api.log(`error testing path ${path} not a folder`, 'settings');
            resolve(false);
          }
        }
      });
    });
  }

  return api;
};