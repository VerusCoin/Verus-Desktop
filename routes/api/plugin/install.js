const { hashFile } = require("../utils/hashFile");
const { randomBytes } = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const { unzipFile } = require("../utils/unzip");
const { verifyHash } = require("../utils/verifySignature");
const { dialog } = require('electron');

module.exports = (api) => {
  api.installPlugin = async (zipPath) => {
    try {
      api.log(`starting plugin install from ${zipPath}...`, 'installPlugin')
      api.log(`unpacking ${zipPath}...`, 'installPlugin')
      
      const appId = randomBytes(32).toString('hex')
      const tmpDir = path.join(api.paths.pluginsTempDir, appId)
      const pluginZipPath = path.join(tmpDir, 'plugin.zip')
      const infoFilePath = path.join(tmpDir, 'info.txt')
      let infoJson = null
      let fileHash = null

      // Unzip main archive
      try {
        await fs.mkdir(tmpDir)
        await unzipFile(zipPath, tmpDir)
      } catch(e) {
        api.log(e, 'installPlugin')
        throw new Error("Failed to unzip main plugin archive!")
      }

      // Read info JSON file
      try {
        infoJson = JSON.parse(await fs.readFile(infoFilePath, 'utf8'))
      } catch(e) {
        api.log(e, 'installPlugin')
        throw new Error("Failed to read plugin info text file!")
      }

      // Hash plugin app archive (sha256)
      try {
        fileHash = await hashFile(pluginZipPath)
      } catch(e) {
        api.log(e, 'installPlugin')
        throw new Error("Failed to hash plugin app archive!")
      }

      if (!infoJson.hash || !infoJson.signer || !infoJson.signature || !infoJson.app_name) {
        throw new Error('Plugin app info JSON incomplete!')
      }
      
      if (infoJson.hash !== fileHash) 
        throw new Error(`Failed to verify plugin archive hash! (${infoJson.hash} != ${fileHash})`)
      
      // Verify plugin signature with online VerusID verification endpoint
      try {
        if (!(await verifyHash(infoJson.hash, infoJson.signer, infoJson.signature))) {
          throw new Error("Plugin signature verification failed.")
        }
      } catch(e) {
        api.log(e, 'installPlugin')
        throw new Error("Failed to verify app archive signature!")
      }
      
      // Ask user for install
      const res = await dialog.showMessageBox({
        type: "question",
        title: "Install Plugin?",
        message: "Verus Desktop is attempting to install the following plugin. Make sure it is from a trusted source and you trust the signing identity.\n\n" + 
        "Name: " + infoJson.app_name + "\n\n" + "Signing Identity: " + infoJson.signer,
        buttons: ["Yes", "No"]
      })

      if (res.response === 0) {
        // Copy tmp to file
        const pluginDir = path.join(api.paths.pluginsDir, appId)

        try {
          await fs.mkdir(pluginDir)
          await unzipFile(pluginZipPath, pluginDir)
          await fs.copyFile(infoFilePath, path.join(pluginDir, 'info.txt'))
          await fs.copyFile(path.join(tmpDir, 'logo.png'), path.join(pluginDir, 'logo.png'))

          api.plugins.registry[appId] = {
            permissions: null,
            handle: null,
            path: pluginDir,
            name: infoJson.app_name
          }

          api.saveLocalPluginRegistry(api.plugins.registry)

          api.log(`Plugin from ${zipPath} installed successfully!`, 'installPlugin')

          await fs.rmdir(tmpDir, { recursive: true })

          return {
            installed: true,
            id: appId
          }
        } catch(e) {
          api.log(e, 'installPlugin')
          throw new Error("Error performing final install!")
        }
      } else {
        return {
          installed: false,
          id: null
        }
      }
    } catch (e) {
      api.log(`Error installing plugin at ${zipPath}.`, 'installPlugin')
      api.log(e, 'installPlugin')
      throw e
    }
  }

  api.setPost('/plugin/install', async (req, res, next) => {
    const { path } = req.body
   
    try {
      const retObj = {
        msg: 'success',
        result: await api.installPlugin(path),
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