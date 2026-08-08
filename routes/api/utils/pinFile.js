const fs = require("fs-extra");
const aes256 = require("nodejs-aes256");
const iocane = require("iocane");
const { atomicCreateFileSync } = require("./atomicFile");

const MAX_PIN_FILE_BYTES = 1024 * 1024;
const session = iocane.createSession()
  .use("cbc")
  .setDerivationRounds(300000);
const encrypt = session.encrypt.bind(session);
const decrypt = session.decrypt.bind(session);

const assertPinPayload = (payload) => {
  if (typeof payload !== "string" || payload.length === 0 ||
      Buffer.byteLength(payload, "utf8") > MAX_PIN_FILE_BYTES) {
    throw new Error("Invalid encrypted PIN file");
  }
};

const isIocanePayload = (payload) => {
  const componentCount = payload.split("$").length;
  return componentCount >= 4 && componentCount <= 6;
};

const decryptPinPayload = async (payload, password) => {
  assertPinPayload(payload);
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Invalid PIN password");
  }

  // nodejs-aes256 ciphertext is standard base64 and cannot contain '$'.
  // Iocane has always used '$'-separated packed components, including its
  // older four- and five-component formats. Selecting by format avoids trying
  // an unauthenticated legacy decrypt against modern authenticated data.
  const modern = isIocanePayload(payload);
  if (!modern &&
      (payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload))) {
    throw new Error("Invalid legacy encrypted PIN file");
  }
  const plaintext = modern
    ? await decrypt(payload, password)
    : aes256.decrypt(password, payload);

  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("Encrypted PIN file did not contain a seed");
  }
  if (!modern && /[\u0000-\u001f\u007f\ufffd]/.test(plaintext)) {
    throw new Error("Incorrect password for legacy encrypted PIN file");
  }
  return plaintext;
};

const encryptPinPayload = async (plaintext, password) => {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("Cannot encrypt an empty seed");
  }
  const encrypted = await encrypt(plaintext, password);
  assertPinPayload(encrypted);
  const verified = await decryptPinPayload(encrypted, password);
  if (verified !== plaintext) throw new Error("Encrypted seed verification failed");
  return encrypted;
};

const readPinFile = async (pinFile) => {
  const stat = await fs.lstat(pinFile);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PIN_FILE_BYTES) {
    throw new Error("PIN path is not a valid encrypted seed file");
  }
  return fs.readFile(pinFile, "utf8");
};

const storeNewPinFile = async (pinFile, encrypted, password, plaintext) => {
  assertPinPayload(encrypted);

  const acceptExisting = async () => {
    const existing = await readPinFile(pinFile);
    const existingPlaintext = await decryptPinPayload(existing, password);
    if (existingPlaintext !== plaintext) {
      const error = new Error("Refusing to overwrite an existing encrypted seed file");
      error.code = "PIN_FILE_EXISTS";
      throw error;
    }
    return false;
  };

  if (await fs.pathExists(pinFile)) return acceptExisting();

  try {
    atomicCreateFileSync(pinFile, encrypted, { mode: 0o600 });
    const committed = await readPinFile(pinFile);
    if (committed !== encrypted ||
        await decryptPinPayload(committed, password) !== plaintext) {
      throw new Error("Stored encrypted seed verification failed");
    }
    return true;
  } catch (error) {
    // A concurrent creator may have won the no-overwrite commit. Never replace
    // it; accept it only if it decrypts to the exact same seed.
    if (error && error.code === "EEXIST") return acceptExisting();
    throw error;
  }
};

module.exports = {
  decryptPinPayload,
  encryptPinPayload,
  isIocanePayload,
  readPinFile,
  storeNewPinFile,
};
