const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execFile, exec } = require('child_process');
const util = require('util');
const { IS_TESTNET } = require('../utils/constants/dev_options');
const run = util.promisify(exec);
const runFile = util.promisify(execFile);

// Increase maxBuffer to handle large outputs (e.g., AppImage extraction).
const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB

function xdgDataHome() {
  return process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
}

async function extractAppImage(appImage, tmpDir) {
  await runFile(appImage, ['--appimage-extract'], { 
    cwd: tmpDir,
    maxBuffer: MAX_BUFFER_SIZE 
  });
  const extractedPath = path.join(tmpDir, 'squashfs-root');
  return extractedPath;
}

async function installIcons(squashRoot) {
  const hicolorBase = path.join(xdgDataHome(), 'icons', 'hicolor');
  const sourceHicolorBase = path.join(squashRoot, 'usr', 'share', 'icons', 'hicolor');

  // Check if hicolor directory exists in AppImage.
  if (!(await fs.pathExists(sourceHicolorBase))) {
    return;
  }

  let iconsCopied = 0;
  
  // Copy all available icon sizes from the hicolor structure.
  const sizeDirs = await fs.readdir(sourceHicolorBase).catch(() => []);
  
  for (const sizeDir of sizeDirs) {
    const sourceSizeDir = path.join(sourceHicolorBase, sizeDir, 'apps');
    const destSizeDir = path.join(hicolorBase, sizeDir, 'apps');
    
    if (await fs.pathExists(sourceSizeDir)) {
      const iconFiles = await fs.readdir(sourceSizeDir).catch(() => []);
      const pngFiles = iconFiles.filter(f => f.toLowerCase().endsWith('.png'));
      
      if (pngFiles.length > 0) {
        await fs.mkdirp(destSizeDir);
        
        for (const pngFile of pngFiles) {
          const sourceIcon = path.join(sourceSizeDir, pngFile);
          const destIcon = path.join(destSizeDir, pngFile);
          
          await fs.copyFile(sourceIcon, destIcon);
          iconsCopied++;
        }
      }
    }
  }

  if (iconsCopied > 0) {
    // Update icon caches if possible.
    const iconCacheCommands = [
      `gtk-update-icon-cache-3.0 -t "${hicolorBase}"`,
      `gtk-update-icon-cache -f "${hicolorBase}"`,
      `update-icon-caches "${path.dirname(hicolorBase)}"`
    ];
    
    for (const command of iconCacheCommands) {
      try {
        await run(command, { maxBuffer: MAX_BUFFER_SIZE });
      } catch {}
    }
  }
}

// Moves the desktop file from the extracted AppImage, modifies the execution so
// that it works for electron, and returns the contents and path of the file.
async function installDesktopFile(squashRoot, appImage) {
  const appsDir = path.join(xdgDataHome(), 'applications');
  await fs.mkdirp(appsDir);
  
  // Find the desktop file in the extracted AppImage dynamically.
  const files = await fs.readdir(squashRoot);
  const desktopFileName = files.find(file => file.endsWith('.desktop'));
  
  if (!desktopFileName) {
    throw new Error('No desktop file found in AppImage');
  }

  const sourceDesktopFile = path.join(squashRoot, desktopFileName);
  
  if (!(await fs.pathExists(sourceDesktopFile))) {
    throw new Error(`Desktop file not found in AppImage at ${sourceDesktopFile}`);
  }

  let desktopFileContent = await fs.readFile(sourceDesktopFile, 'utf8');
  let adjustedDesktopFileName = desktopFileName;

  const desktopFileBaseName = desktopFileName.replace(/\.desktop$/, '');

  // Extract X-AppImage-Version and append to Name in parentheses.
  const versionMatch = desktopFileContent.match(/^X-AppImage-Version=(.+)$/m);
  if (versionMatch) {
    const version = versionMatch[1].trim();
    
    desktopFileContent = desktopFileContent.replace(
      /^Name=(.+)$/m,
      (match, name) => {
        const trimmedName = name.trim();
        if (!trimmedName.includes(`(${version})`)) {
          return `Name=${trimmedName} (${version})`;
        }
        return match;
      }
    );

    // Add the version if possible to the desktop file name.
    const versionSuffix = `-${version}`;
    const desktopFileNameWithId = `${desktopFileBaseName}${versionSuffix}.desktop`;
    adjustedDesktopFileName = desktopFileNameWithId;
  }

  const desktopFile = path.join(appsDir, adjustedDesktopFileName);

  // Remove stale desktop files to clean up the cache.
  for (const filename of await fs.readdir(appsDir)) {
    if (filename.startsWith(desktopFileBaseName) && filename.endsWith('.desktop')) {

      // Don't delete testnet files if not installing testnet and vice versa.
      if (IS_TESTNET === filename.includes('testnet')) {
        await fs.remove(path.join(appsDir, filename)).catch(() => {});
      }
    }
  }

  // Replace AppRun with the actual AppImage path and append --no-sandbox %U
  // Need to have --no-sandbox for Electron otherwise the deeplinks fail.
  desktopFileContent = desktopFileContent.replace(
    /^Exec=.*$/m,
    `Exec=${appImage} --no-sandbox %U`
  );

  await fs.writeFile(desktopFile, desktopFileContent, { mode: 0o644 });
  
  return { content: desktopFileContent, path: desktopFile };
}

async function registerDesktopFile(desktopFileName, desktopFileContent) {
  const appsDir = path.dirname(desktopFileName);

  // Extract MimeType from the provided desktop file.
  let mimeTypes = [];
  const mimeTypeMatch = desktopFileContent.match(/^MimeType=(.+)$/m);
  if (mimeTypeMatch) {
    mimeTypes = mimeTypeMatch[1].split(';').map(m => m.trim()).filter(m => m.length > 0);
  }

  // Skip registration if no MIME types found in desktop file
  if (mimeTypes.length === 0) {
    return;
  }

  // Create the desktop integration.
  await run(`update-desktop-database "${appsDir}"`, { maxBuffer: MAX_BUFFER_SIZE });
  
  // Force update desktop menu.
  try {
    await run(`xdg-desktop-menu forceupdate`, { maxBuffer: MAX_BUFFER_SIZE });
  } catch {}

  for (const mimeType of mimeTypes) {
    try {
      await run(`xdg-mime default "${path.basename(desktopFileName)}" "${mimeType}"`, { maxBuffer: MAX_BUFFER_SIZE });
    } catch {}
  }
  
  // Update MIME database.
  try {
    const mimeDir = path.join(xdgDataHome(), 'mime');
    await run(`update-mime-database "${mimeDir}"`, { maxBuffer: MAX_BUFFER_SIZE });
  } catch {}
}

module.exports = (api) => {
  api.installLinuxDeeplinkIntegration = async () => {
    if (process.platform !== 'linux') return;

    // Always run the integration so that if the appimage moves or a new version is being used,
    // the user will always have a working integration.

    const appImage = process.env.APPIMAGE;
    
    // Skip it if not running from an AppImage.
    if (!appImage || !(await fs.pathExists(appImage))) {
      return;
    }

    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'verus-appimage-'));
    
    try {
      const squashRoot = await extractAppImage(appImage, tmpBase);
      await installIcons(squashRoot);
      const desktopFileResult = await installDesktopFile(squashRoot, appImage);
      await registerDesktopFile(desktopFileResult.path, desktopFileResult.content);
    } finally {
      await fs.remove(tmpBase);
    }
  }

  return api;
};
