const fs = require('fs-extra');
const path = require('path');
const { createHash, randomBytes } = require('crypto');
const {
  atomicWriteFileSync,
  fsyncDirectoryBestEffort,
} = require('./utils/atomicFile');
let _foldersInitRan = false;

const UPGRADE_SAFETY_SNAPSHOT = "pre-security-hardening-v1";
const SENSITIVE_APPDATA_FILES = new Set([
  "builtinsecret.json",
  "config.json",
  "nameCommits.json",
  "users.json",
]);
const hashFile = (filename) =>
  createHash("sha256").update(fs.readFileSync(filename)).digest("hex");

const listCriticalRelativePaths = (appDataDirectory) => {
  const critical = [];
  const topLevelCandidates = [
    "config.json",
    "config.json.bak",
    "users.json",
    "users.json.bak",
    "nameCommits.json",
    "nameCommits.json.bak",
  ];

  for (const entry of fs.readdirSync(appDataDirectory, { withFileTypes: true })) {
    if (entry.isFile() && /^users_backup_[0-9]+\.json$/.test(entry.name)) {
      topLevelCandidates.push(entry.name);
    }
  }

  for (const relativePath of topLevelCandidates) {
    const candidate = path.join(appDataDirectory, relativePath);
    if (!fs.existsSync(candidate)) continue;
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`Recovery-critical path is not a regular file: ${relativePath}`);
    }
    critical.push(relativePath);
  }

  const pinDirectory = path.join(appDataDirectory, "shepherd", "pin");
  if (fs.existsSync(pinDirectory)) {
    const pinDirectoryStat = fs.lstatSync(pinDirectory);
    if (pinDirectoryStat.isSymbolicLink() || !pinDirectoryStat.isDirectory()) {
      throw new Error("Recovery-critical PIN path is not a regular directory");
    }
    for (const entry of fs.readdirSync(pinDirectory, { withFileTypes: true })) {
      if (!entry.name.endsWith(".pin") && !entry.name.endsWith(".pin.bak")) continue;
      if (!entry.isFile()) {
        throw new Error(`Recovery-critical PIN is not a regular file: ${entry.name}`);
      }
      critical.push(path.join("shepherd", "pin", entry.name));
    }
  }

  return [...new Set(critical)].sort();
};

module.exports = (api) => {
  api.hardenBuiltinSecretCopies = () => {
    const secretName = "builtinsecret.json";
    const liveSecret = path.join(api.paths.agamaDir, secretName);
    const livePinDirectory = path.join(api.paths.agamaDir, "shepherd", "pin");

    try {
      if (fs.existsSync(api.paths.agamaDir)) fs.chmodSync(api.paths.agamaDir, 0o700);
      if (fs.existsSync(liveSecret)) fs.chmodSync(liveSecret, 0o600);
      for (const filename of SENSITIVE_APPDATA_FILES) {
        const sensitiveFile = path.join(api.paths.agamaDir, filename);
        if (fs.existsSync(sensitiveFile) && fs.lstatSync(sensitiveFile).isFile()) {
          fs.chmodSync(sensitiveFile, 0o600);
        }
      }
      if (fs.existsSync(livePinDirectory)) {
        fs.chmodSync(livePinDirectory, 0o700);
        for (const entry of fs.readdirSync(livePinDirectory, { withFileTypes: true })) {
          if (entry.isFile() && (entry.name.endsWith(".pin") || entry.name.endsWith(".pin.bak"))) {
            fs.chmodSync(path.join(livePinDirectory, entry.name), 0o600);
          }
        }
      }

      if (fs.existsSync(api.paths.backupDir)) {
        const pending = [api.paths.backupDir];
        while (pending.length) {
          const current = pending.pop();
          const stat = fs.lstatSync(current);
          if (!stat.isDirectory() || stat.isSymbolicLink()) continue;

          fs.chmodSync(current, 0o700);
          for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const entryPath = path.join(current, entry.name);
            if (entry.isDirectory() && !entry.isSymbolicLink()) pending.push(entryPath);
            else if (entry.isFile() &&
                     (SENSITIVE_APPDATA_FILES.has(entry.name) ||
                      entry.name.endsWith(".bak") ||
                      entry.name.endsWith(".pin"))) {
              fs.chmodSync(entryPath, 0o600);
            }
          }
        }
      }
    } catch (e) {
      api.log(`Unable to harden app data permissions: ${e.message}`, "init");
    }
  };

  api.createUpgradeSafetySnapshot = () => {
    const criticalRelativePaths = listCriticalRelativePaths(api.paths.agamaDir);
    if (criticalRelativePaths.length === 0) return null;

    const preferredDestination = path.join(api.paths.backupDir, UPGRADE_SAFETY_SNAPSHOT);
    const preferredMarker = path.join(preferredDestination, ".complete");
    if (fs.existsSync(preferredMarker)) {
      try {
        const marker = JSON.parse(fs.readFileSync(preferredMarker, "utf8"));
        if (!marker.files || typeof marker.files !== "object" ||
            Object.keys(marker.files).length === 0) {
          throw new Error("snapshot marker has no checksums");
        }
        for (const [relativePath, expectedHash] of Object.entries(marker.files)) {
          if (typeof relativePath !== "string" || path.isAbsolute(relativePath) ||
              relativePath.split(/[\\/]+/).includes("..") ||
              !/^[0-9a-f]{64}$/.test(expectedHash)) {
            throw new Error("snapshot marker is invalid");
          }
          const backedUp = path.join(preferredDestination, relativePath);
          if (!fs.existsSync(backedUp) || hashFile(backedUp) !== expectedHash) {
            throw new Error(`snapshot checksum failed for ${relativePath}`);
          }
        }
        for (const relativePath of listCriticalRelativePaths(preferredDestination)) {
          if (!Object.prototype.hasOwnProperty.call(marker.files, relativePath)) {
            throw new Error(`snapshot marker does not cover ${relativePath}`);
          }
        }
        return preferredDestination;
      } catch (error) {
        api.log(`Existing safety snapshot is incomplete: ${error.message}`, "init");
      }
    }

    const suffix = `${Date.now()}-${process.pid}-${randomBytes(8).toString("hex")}`;
    const destination = fs.existsSync(preferredDestination)
      ? `${preferredDestination}-recovery-${suffix}`
      : preferredDestination;
    const staging = path.join(
      api.paths.backupDir,
      `.${UPGRADE_SAFETY_SNAPSHOT}.tmp-${suffix}`
    );

    try {
      fs.mkdirSync(staging, { mode: 0o700 });
      fs.copySync(api.paths.agamaDir, staging, {
        errorOnExist: true,
        overwrite: false,
        preserveTimestamps: true,
      });

      const fileHashes = {};
      for (const relativePath of criticalRelativePaths) {
        const source = path.join(api.paths.agamaDir, relativePath);
        if (!fs.existsSync(source)) continue;
        const copied = path.join(staging, relativePath);
        const sourceHash = hashFile(source);
        if (!fs.existsSync(copied) || hashFile(copied) !== sourceHash) {
          throw new Error(`Safety snapshot verification failed for ${relativePath}`);
        }
        const copiedFile = fs.openSync(copied, "r+");
        try {
          fs.fsyncSync(copiedFile);
        } finally {
          fs.closeSync(copiedFile);
        }
        fileHashes[relativePath] = sourceHash;
      }

      atomicWriteFileSync(
        path.join(staging, ".complete"),
        JSON.stringify({
          createdAt: new Date().toISOString(),
          source: api.paths.agamaDir,
          files: fileHashes,
        }),
        { backup: false, mode: 0o600 }
      );
      fs.renameSync(staging, destination);
      fsyncDirectoryBestEffort(api.paths.backupDir);
      api.log(`Created pre-upgrade safety snapshot at ${destination}`, "init");
      return destination;
    } catch (error) {
      try { if (fs.existsSync(staging)) fs.removeSync(staging); } catch (cleanupError) {}
      // Fail closed before config or identity data is initialized. The live
      // data has not been changed at this point.
      throw new Error(`Unable to create required pre-upgrade safety snapshot: ${error.message}`);
    }
  };

  // Moves existing data to new directory
  api.updateDataFolderFormatv071 = () => {
    const oldDirs = [
      `shepherd`,
      `config.json`,
      `users.json`,
      `nameCommits.json`,
      `updatelog.json`,
      `spv-cache.json`,
      `electrumServers.json`,
      `kvElectrumServersCache.json`,
      `exchanges-cache.json`,
    ];
    for (const entry of fs.readdirSync(api.paths.VerusDesktopDir)) {
      if (/^users_backup_[0-9]+\.json$/.test(entry)) oldDirs.push(entry);
    }
    const stagingDirectory = `${api.paths.agamaDir}.migration-${process.pid}-${Date.now()}`;

    try {
      fs.mkdirSync(stagingDirectory, { mode: 0o700 });
      oldDirs.forEach((dir) => {
        const source = path.join(api.paths.VerusDesktopDir, dir);
        const destination = path.join(stagingDirectory, dir);
        if (fs.existsSync(source)) {
          fs.copySync(source, destination, { errorOnExist: true, overwrite: false });
          api.log(`staged ${source} for app-data migration`, 'init');
        }
      });
      fs.renameSync(stagingDirectory, api.paths.agamaDir);
      api.log(`atomically migrated legacy app data to ${api.paths.agamaDir}`, 'init');
    } catch (error) {
      // The legacy source remains untouched until the final rename. This
      // staging path is unique to the current invocation.
      try { if (fs.existsSync(stagingDirectory)) fs.removeSync(stagingDirectory); } catch (cleanupError) {}
      throw new Error(`Unable to safely migrate legacy app data: ${error.message}`);
    }
  }

  api.isOldDataFolderFormat = () => {    
    return (
      fs.existsSync(api.paths.VerusDesktopDir) &&
      !fs.existsSync(api.paths.agamaDir)
    ) 
  }

  api.createAgamaDirs = () => {
    let firstRun = false

    if (!_foldersInitRan) {
      const rootLocation = path.join(__dirname, '../../');

      fs.readdir(rootLocation, (err, items) => {
        for (let i = 0; i < items.length; i++) {
          if (items[i].substr(0, 3) === 'gen') {
            api.log(`remove ${items[i]}`, 'init');
            fs.unlinkSync(rootLocation + items[i]);
          }
        }
      });

      if (!fs.existsSync(api.paths.VerusDesktopDir)) {
        fs.mkdirSync(api.paths.VerusDesktopDir, { mode: 0o700 });

        if (fs.existsSync(api.paths.VerusDesktopDir)) {
          api.log(`created verus desktop main folder at ${api.paths.VerusDesktopDir}`, 'init');
          firstRun = true;
        }
      } else {
        api.log('verus desktop main folder already exists', 'init');
      }

      if (!fs.existsSync(api.paths.agamaDir)) {  
        if (api.isOldDataFolderFormat()) {
          api.updateDataFolderFormatv071()
        } else {
          fs.mkdirSync(api.paths.agamaDir, { mode: 0o700 });
        }

        if (fs.existsSync(api.paths.agamaDir)) {
          api.log(`created verus desktop appdata folder at ${api.paths.agamaDir}`, 'init');
        }
      } else {
        api.log('verus desktop appdata folder already exists', 'init');
      }

      if (!fs.existsSync(api.paths.pluginsDir)) {  
        fs.mkdirSync(api.paths.pluginsDir);

        if (fs.existsSync(api.paths.pluginsDir)) {
          api.log(`created verus desktop plugins folder at ${api.paths.pluginsDir}`, 'init');
        }
      } else {
        api.log('verus desktop plugins folder already exists', 'init');
      }

      if (!fs.existsSync(api.paths.pluginsTempDir)) {  
        fs.mkdirSync(api.paths.pluginsTempDir);

        if (fs.existsSync(api.paths.pluginsTempDir)) {
          api.log(`created verus desktop plugins temp folder at ${api.paths.pluginsTempDir}`, 'init');
        }
      } else {
        api.log('verus desktop plugins temp folder already exists', 'init');
      }

      if (!fs.existsSync(api.paths.backupDir)) {
        fs.mkdirSync(api.paths.backupDir, { mode: 0o700 });

        if (fs.existsSync(api.paths.backupDir)) {
          api.log(`created verus desktop backup folder at ${api.paths.backupDir}`, 'init');
        }
      } else {
        api.log('verus desktop backup folder already exists', 'init');
      }

      api.createUpgradeSafetySnapshot();

      if (!fs.existsSync(api.paths.crashesDir)) {
        fs.mkdirSync(api.paths.crashesDir);

        if (fs.existsSync(api.paths.crashesDir)) {
          api.log(`created verus desktop crash report folder at ${api.paths.crashesDir}`, 'init');
        }
      } else {
        api.log('verus desktop crash report folder already exists', 'init');
      }

      if (!fs.existsSync(`${api.paths.agamaDir}/shepherd`)) {
        fs.mkdirSync(`${api.paths.agamaDir}/shepherd`, { mode: 0o700 });

        if (fs.existsSync(`${api.paths.agamaDir}/shepherd`)) {
          api.log(`created shepherd folder at ${api.paths.agamaDir}/shepherd`, 'init');
        }
      } else {
        api.log('agama/shepherd folder already exists', 'init');
      }

      const _subFolders = [
        'pin',
        'csv',
        'log',
        'currencies'
      ];

      for (let i = 0; i < _subFolders.length; i++) {
        if (!fs.existsSync(`${api.paths.agamaDir}/shepherd/${_subFolders[i]}`)) {
          fs.mkdirSync(`${api.paths.agamaDir}/shepherd/${_subFolders[i]}`, { mode: 0o700 });

          if (fs.existsSync(`${api.paths.agamaDir}/shepherd/${_subFolders[i]}`)) {
            api.log(`created ${_subFolders[i]} folder at ${api.paths.agamaDir}/shepherd/${_subFolders[i]}`, 'init');
          }
        } else {
          api.log(`shepherd/${_subFolders[i]} folder already exists`, 'init');
        }
      }

      if (!fs.existsSync(api.paths.zcashParamsDir)) {
        fs.mkdirSync(api.paths.zcashParamsDir);
      } else {
        api.log('zcashparams folder already exists', 'init');
      }

      api.hardenBuiltinSecretCopies();
      _foldersInitRan = true;
    }

    return firstRun
  }

  api.compareNSPVCoinsFile = () => {
    const rootLocation = path.join(__dirname, '../../');
    const nspvCoinsAgamaDirSize = fs.existsSync(`${api.paths.agamaDir}/coins`) && fs.lstatSync(`${api.paths.agamaDir}/coins`);
    let localNSPVCoinsFile = fs.lstatSync(`${rootLocation}/routes/nspv_coins`);
    
    if (!nspvCoinsAgamaDirSize ||
        (nspvCoinsAgamaDirSize && nspvCoinsAgamaDirSize.size !== localNSPVCoinsFile.size)) {
      api.log('NSPV coins file mismatch, copy over', 'init');
      localNSPVCoinsFile = fs.readFileSync(`${rootLocation}/routes/nspv_coins`, 'utf8');
      fs.writeFileSync(`${api.paths.agamaDir}/coins`, localNSPVCoinsFile, 'utf8');
    } else {
      api.log('NSPV coins file is matching', 'init');
    }

    api.parseNSPVports();
  };

  api.parseNSPVports = () => {
    const nspvCoinsAgamaDirExists = fs.existsSync(`${api.paths.agamaDir}/coins`);
    let nspvPorts = {};
    
    if (nspvCoinsAgamaDirExists) {
      const nspvCoinsContent = fs.readFileSync(`${api.paths.agamaDir}/coins`, 'utf8');

      try {
        const nspvCoinsContentJSON = JSON.parse(nspvCoinsContent);

        for (let item of nspvCoinsContentJSON) {
          nspvPorts[item.coin] = item.rpcport;
        }
        api.log(`NSPV coins file ${nspvCoinsContentJSON.length} supported coins`, 'init');
      } catch (e) {
        api.log('NSPV coins file unable to parse!', 'init');
      }
    } else {
      api.log('NSPV coins file doesn\'t exist!', 'init');
    }

    api.nspvPorts = nspvPorts;
    
    // extend dpow coins list
    const dpowCoins = Object.keys(nspvPorts);
    api.dpowCoins = [...new Set([].concat(...[api.dpowCoins, dpowCoins]))];
  };

  return api;
};
