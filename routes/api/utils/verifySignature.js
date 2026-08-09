async function verifyHash(hash, id, signature, verifier) {
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/i.test(hash)) {
    throw new Error("Invalid plugin hash");
  }
  if (typeof id !== "string" || id.length === 0 || id.length > 256) {
    throw new Error("Invalid plugin signing identity");
  }
  if (typeof signature !== "string" || signature.length === 0 || signature.length > 16384) {
    throw new Error("Invalid plugin signature");
  }
  if (typeof verifier !== "function") {
    throw new Error("No local plugin signature verifier is available");
  }

  const result = await verifier(id, hash, signature);
  return result === true;
}

module.exports = {
  verifyHash
}
