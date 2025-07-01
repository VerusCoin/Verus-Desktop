const {
  Credential,
  DATA_TYPE_OBJECT_CREDENTIAL,
} = require("verus-typescript-primitives");

// parseCredential converts a credential object from a data descriptor into a credential class.
const parseCredential = (credObj) => {
  const credJson = credObj[DATA_TYPE_OBJECT_CREDENTIAL.vdxfid];

  return Credential.fromJson(credJson);
};

module.exports = {
  parseCredential
};