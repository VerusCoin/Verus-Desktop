const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const temporarySibling = (target, label) =>
  path.join(
    path.dirname(target),
    `.${path.basename(target)}.${label}.${process.pid}.${crypto.randomBytes(8).toString("hex")}`
  );

const fsyncDirectoryBestEffort = (directory) => {
  let fd;
  try {
    fd = fs.openSync(directory, "r");
    fs.fsyncSync(fd);
  } catch (error) {
    // Directory fsync is unavailable on some supported platforms. The file
    // itself is still synced before its atomic rename.
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
};

const assertReplaceableTarget = (target) => {
  if (!fs.existsSync(target)) return false;
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Refusing to replace a non-regular file: ${target}`);
  }
  return true;
};

const writeAndSync = (file, data, mode) => {
  const fd = fs.openSync(file, "wx", mode);
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(file, mode);
};

const copyAndSync = (source, destination, mode) => {
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(destination, mode);
  const fd = fs.openSync(destination, "r+");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (!fs.readFileSync(source).equals(fs.readFileSync(destination))) {
    throw new Error(`Backup verification failed for ${source}`);
  }
};

const verifyContents = (target, expected) => {
  const actual = fs.readFileSync(target);
  if (!actual.equals(expected)) {
    throw new Error(`Durable write verification failed for ${target}`);
  }
};

const commitNewFileNoReplace = (source, target, mode) => {
  try {
    fs.linkSync(source, target);
  } catch (error) {
    // FAT/exFAT volumes used by portable mode do not support hard links.
    // COPYFILE_EXCL retains the essential safety property: an older file can
    // never be truncated or replaced.
    if (!["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV"].includes(error.code)) {
      throw error;
    }
    copyAndSync(source, target, mode);
  }
  fs.chmodSync(target, mode);
  verifyContents(target, fs.readFileSync(source));
};

/**
 * Durably replaces a small persistent file without ever truncating the live
 * file. Before the first replacement, the original contents are retained in
 * `${target}.bak`. That recovery copy is never rotated automatically, so a
 * later corrupt primary file cannot overwrite the known recoverable copy.
 */
const atomicWriteFileSync = (target, data, options = {}) => {
  const {
    backup = true,
    mode = 0o600,
    validate,
  } = options;
  const directory = path.dirname(target);
  const serialized = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");

  if (typeof validate === "function") validate(serialized);
  const targetExists = assertReplaceableTarget(target);
  const writeTemp = temporarySibling(target, "write");
  let backupTemp = null;

  try {
    writeAndSync(writeTemp, serialized, mode);
    const persisted = fs.readFileSync(writeTemp);
    if (!serialized.equals(persisted)) throw new Error(`Write verification failed for ${target}`);
    if (typeof validate === "function") validate(persisted);

    if (targetExists && backup) {
      const backupFile = `${target}.bak`;
      const backupExists = assertReplaceableTarget(backupFile);
      if (!backupExists) {
        backupTemp = temporarySibling(target, "backup");
        // Preserve the exact pre-write bytes even if they fail the new
        // validator. Partially recoverable legacy data must never be replaced
        // by a copy of the new value under the guise of a backup.
        copyAndSync(target, backupTemp, mode);
        try {
          commitNewFileNoReplace(backupTemp, backupFile, mode);
        } catch (error) {
          // If another writer won the no-replace race, accept only the exact
          // same recovery bytes. A different backup must stop the live write.
          if (error.code !== "EEXIST" ||
              !assertReplaceableTarget(backupFile) ||
              !fs.readFileSync(backupTemp).equals(fs.readFileSync(backupFile))) {
            throw error;
          }
        }
        fs.unlinkSync(backupTemp);
        backupTemp = null;
      }
    }

    fs.renameSync(writeTemp, target);
    fs.chmodSync(target, mode);
    verifyContents(target, serialized);
    fsyncDirectoryBestEffort(directory);
  } catch (error) {
    try { if (fs.existsSync(writeTemp)) fs.unlinkSync(writeTemp); } catch (cleanupError) {}
    try { if (backupTemp && fs.existsSync(backupTemp)) fs.unlinkSync(backupTemp); } catch (cleanupError) {}
    throw error;
  }
};

/**
 * Commits a completely written file only when no destination exists. The
 * no-replace commit cannot truncate or replace an older PIN file.
 */
const atomicCreateFileSync = (target, data, options = {}) => {
  const { mode = 0o600, validate } = options;
  const directory = path.dirname(target);
  const serialized = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");

  if (typeof validate === "function") validate(serialized);
  if (assertReplaceableTarget(target)) {
    const error = new Error(`File already exists: ${target}`);
    error.code = "EEXIST";
    throw error;
  }

  const writeTemp = temporarySibling(target, "create");
  try {
    writeAndSync(writeTemp, serialized, mode);
    commitNewFileNoReplace(writeTemp, target, mode);
    fsyncDirectoryBestEffort(directory);
  } finally {
    try { if (fs.existsSync(writeTemp)) fs.unlinkSync(writeTemp); } catch (cleanupError) {}
  }
};

const validateJsonBuffer = (buffer) => JSON.parse(buffer.toString("utf8"));

module.exports = {
  atomicCreateFileSync,
  atomicWriteFileSync,
  fsyncDirectoryBestEffort,
  validateJsonBuffer,
};
