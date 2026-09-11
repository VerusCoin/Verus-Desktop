const assertSingleSignatureIdentity = (identity) => {
  if (
    identity == null ||
    !Array.isArray(identity.primaryaddresses) ||
    identity.primaryaddresses.length !== 1 ||
    identity.minimumsignatures !== 1
  ) {
    throw new Error(
      "Verus Desktop can only change identities with one primary address and one required signature. Use the CLI to change this identity."
    );
  }
};

module.exports = { assertSingleSignatureIdentity };
