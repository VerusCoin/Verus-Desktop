const fs = require('fs-extra');
const defaultConf = require('../appConfig.js').config;
const { normalizeConfig } = require("./utils/configValidation");
const { atomicWriteFileSync } = require("./utils/atomicFile");

const validateConfigBuffer = (buffer) =>
  normalizeConfig(JSON.parse(buffer.toString("utf8")), defaultConf, { stripUnknown: true });

module.exports = (api) => {
  api.loadLocalConfig = () => {
    const configLocation = `${api.paths.agamaDir}/config.json`
    const parseConfigFile = (file) => {
      const savedConfig = JSON.parse(fs.readFileSync(file, 'utf8'));
      return normalizeConfig(savedConfig, defaultConf, { stripUnknown: true });
    };

    if (fs.existsSync(configLocation)) {
      try {
        api.log('Local app config read successfully, checking diffs...', 'settings');
        // Older releases can leave retired settings behind. They are ignored
        // in memory, but an upgrade never rewrites the user's existing file.
        const localAppConfig = parseConfigFile(configLocation);

        api.log(`Done checking local config diffs.`, 'settings');
        return localAppConfig

      } catch(e) {
        api.log('Unable to load local config.json, error with following message:', 'settings');
        api.log(e.message, 'settings');
        const backupLocation = `${configLocation}.bak`;
        if (fs.existsSync(backupLocation)) {
          try {
            const backupConfig = parseConfigFile(backupLocation);
            api.log('Using validated config.json.bak without modifying either file.', 'settings');
            return backupConfig;
          } catch (backupError) {
            api.log(`Unable to load config.json.bak: ${backupError.message}`, 'settings');
          }
        }
        throw new Error(`Existing config.json is invalid and was left unchanged: ${e.message}`);
      }
    }

    api.log('Setting config to default...', 'settings');
    api.saveLocalAppConf(defaultConf);
    return defaultConf
  };

  api.saveLocalAppConf = (appSettings) => {
    const configFileName = `${api.paths.agamaDir}/config.json`;
    const validatedSettings = normalizeConfig(appSettings, defaultConf);

    try {
      atomicWriteFileSync(configFileName, JSON.stringify(validatedSettings, null, 2), {
        backup: true,
        mode: 0o600,
        validate: validateConfigBuffer,
      });

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
  }, true);

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
  }, true);

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
