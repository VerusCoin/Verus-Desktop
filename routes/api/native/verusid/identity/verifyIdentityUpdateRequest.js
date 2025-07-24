const { IdentityUpdateRequest, IDENTITY_UPDATE_REQUEST_VDXF_KEY } = require("verus-typescript-primitives")

module.exports = (api) => {
  /**
   * Verifies an identity update request
   * @param {IdentityUpdateRequest} Request
   */
  api.native.verusid.identity.verify_identity_update_request = async (coin, request) => {
    const identityUpdateRequest = IdentityUpdateRequest.fromJson(request);

    const verified = await api.native.verify_hash(
      coin,
      identityUpdateRequest.signingid.toAddress(),
      identityUpdateRequest.details.toSha256().toString('hex'),
      // The nesting of the signature does not match the expected structure.
      identityUpdateRequest.signature.signature.signature
    );

    return verified ? { verified } : { verified, message: "Failed to verify signature" };
  };

  api.setPost("/native/verusid/identity/verify_identity_update_request", async (req, res, next) => {
    const { chainTicker, request } = req.body;

    try {
      res.send(
        JSON.stringify({
          msg: "success",
          result: await api.native.verusid.identity.verify_identity_update_request(chainTicker, request),
        })
      );
    } catch (e) {
      res.send(
        JSON.stringify({
          msg: "error",
          result: e.message,
        })
      );
    }
  });

  return api;
};