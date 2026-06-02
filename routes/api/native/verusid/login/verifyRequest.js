const { LoginConsentRequest } = require("verus-typescript-primitives")

module.exports = (api) => {
  /**
   * Verifies a login request
   * @param {LoginConsentRequest} Request
   */
  api.native.verusid.login.verify_request = async (coin, request) => {
    const loginConsentRequest = new LoginConsentRequest(request);

    const verified = await api.native.verify_hash(
      coin,
      loginConsentRequest.signing_id,
      loginConsentRequest.challenge.toSha256().toString('hex'),
      loginConsentRequest.signature.signature
    );

    return verified ? { verified } : { verified, message: "Failed to verify signature" };
  };

  api.setPost("/native/verusid/login/verify_request", async (req, res, next) => {
    const { chainTicker, request } = req.body;

    try {
      res.send(
        JSON.stringify({
          msg: "success",
          result: await api.native.verusid.login.verify_request(chainTicker, request),
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
