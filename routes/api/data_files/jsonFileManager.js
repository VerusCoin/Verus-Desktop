const fs = require('fs-extra');
const { ALLOWED_PATHS_ARR } = require('../utils/constants/index');
const { atomicWriteFileSync, validateJsonBuffer } = require("../utils/atomicFile");

module.exports = (api) => {
  api.handleFileProblem = (desc, throwError) => {
    api.log(desc, 'jsonFileManager');

    if (throwError) {
      throw new Error(desc)
    }  
  }

  /**
   * Loads a JSON object from a filepath,
   * and saves it as empty with a description
   * if it doesnt exist
   */
  api.loadJsonFile = async (relativePath, description, handleMissing = true, permissions = 0o600) => {
    if (ALLOWED_PATHS_ARR.includes(relativePath)) {
      const path = `${api.paths.agamaDir}/${relativePath}`

      if (fs.existsSync(path)) {
        await fs.chmod(path, permissions);
        const parseStoredJson = async (file) => {
          const localString = await fs.readFile(file, 'utf8');
          const parsed = JSON.parse(localString);
          if (parsed.data == null || parsed.description == null) {
            api.log(`${file} file detected with deprecated format; leaving it unchanged.`, 'jsonFileManager');
            return parsed;
          }
          return parsed.data;
        };

        try {
          const localJson = await parseStoredJson(path);
          api.log(`${path} set from local file`, 'loadJsonFile');
          return localJson;
        } catch (e) {
          api.handleFileProblem(`unable to parse local ${path}`, false)
          const backupPath = `${path}.bak`;
          if (fs.existsSync(backupPath)) {
            try {
              const backupJson = await parseStoredJson(backupPath);
              api.log(`Using validated ${relativePath}.bak without modifying either file.`, 'jsonFileManager');
              return backupJson;
            } catch (backupError) {
              api.log(`unable to parse ${relativePath}.bak: ${backupError.message}`, 'jsonFileManager');
            }
          }
          throw new Error(`Existing ${relativePath} is invalid and was left unchanged: ${e.message}`);
        }
      } else {
        api.handleFileProblem(`local ${path} file is not found, saving empty json file.`, !handleMissing)
        await api.saveJsonFile({}, relativePath, description);
  
        return {};
      }
    } else {
      api.handleFileProblem(`${relativePath} path is not on the approved list of file paths, aborting and returning empty JSON.`, !handleMissing)

      return {};
    }
  };

  /**
   * Saves JSON object to file, with optional description
   * for those who want to look at the file
   */
  api.saveJsonFile = async (
    json,
    relativePath,
    description = "No description for this file was provided by the wallet devs :(",
    handleErrors = true,
    permissions = 0o600,
    backup = true
  ) => {
    if (ALLOWED_PATHS_ARR.includes(relativePath)) {
      const path = `${api.paths.agamaDir}/${relativePath}`;

      try {
        atomicWriteFileSync(path, JSON.stringify({ description, data: json }), {
          backup,
          mode: permissions,
          validate: validateJsonBuffer,
        });

        api.log(
          `json file is created successfully at: ${path}`,
          "saveJsonFile"
        );
        return
      } catch (e) {
        api.handleFileProblem(e, false)
        throw e
      }
    } else {
      api.handleFileProblem(`${relativePath} path is not on the approved list of file paths, aborting file save.`, !handleErrors)
      return
    }
  };

  api = require('./currencyData')(api)
  api = require('./nameCommitments')(api)
  api = require('./backup')(api)
  api = require('./updateLog')(api)
  api = require('./secrets')(api)
  return api;
};
