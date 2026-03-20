const fs = require('fs-extra');

module.exports = (api) => {
  /**
   * Backs up all necessary app data stored for Verus Desktop
   */
  api.backupAppData = async (backupName) => {
    if (
      backupName.includes(".") ||
      backupName.includes("/") ||
      backupName.includes("\\") ||
      backupName.includes("*") ||
      backupName.includes("~") || 
      backupName == null
    ) {
      throw new Error(`Backup data name (${backupName}) cannot include any of the following: ./\\*~`)
    }

    try {
      await fs.access(api.paths.agamaDir, fs.constants.R_OK);
    } catch (e) {
      if (e.code == "EACCES") {
        await fs.chmod(path, "0600");
      } else if (e.code === "ENOENT") {
        api.handleFileProblem(`Verus Desktop directory not found`, !handleErrors)
        return
      }
    }

    try {
      const backupPath = `${api.paths.backupDir}/${backupName}`

      if (await fs.exists(backupPath)) {
        throw new Error(`Backup at ${backupPath} already exists!`)
      }

      await fs.copy(api.paths.agamaDir, backupPath);

      api.log(
        `appdata backup created at ${backupPath}`,
        "backup"
      );
      return
    } catch (e) {
      api.log(e, 'backup');
      throw e
    }
  };

  api.setPost('/backup_appdata', async (req, res, next) => {
    const { dirName } = req.body
   
    try {
      const retObj = {
        msg: 'success',
        result: await api.backupAppData(dirName),
      };

      res.send(JSON.stringify(retObj));
    } catch (e) {
      const retObj = {
        msg: 'error',
        result: e.message,
      };

      res.send(JSON.stringify(retObj));
    }
  });

  return api;
};