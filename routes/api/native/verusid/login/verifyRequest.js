const { LoginConsentRequest } = require("verus-typescript-primitives")

module.exports = (api) => {
  /**
   * Verifies a login request
   * @param {LoginConsentRequest} Request
   */
  api.native.verusid.login.verify_request = async (request) => {
    const loginConsentRequest = new LoginConsentRequest(request);
    const chainTicker = request.chainTicker

    const verified = await api.native.verify_hash(
      chainTicker,
      loginConsentRequest.signing_id,
      loginConsentRequest.challenge.toSha256().toString('hex'),
      loginConsentRequest.signature.signature
    );

    return verified ? { verified } : { verified, message: "Failed to verify signature" };
  };

  api.setPost("/native/verusid/login/verify_request", async (req, res, next) => {
    const { request, capability } = req.body;
    const loginConsentCaller =
      req.api_header != null &&
      req.api_header.builtin === true &&
      req.api_header.app_id === "VERUS_LOGIN_CONSENT_UI";
    let verificationClaim = null;

    try {
      // Normal login requests do not receive a provisioning capability. When
      // one is present, verification also activates that exact window-bound
      // provisioning session; omitting it can never activate the proxy.
      if (loginConsentCaller && capability != null) {
        if (
          api.loginConsentUi == null ||
          typeof api.loginConsentUi.beginProvisioningRequestVerification !== "function"
        ) {
          throw new Error("Login Consent provisioning authorization is unavailable");
        }
        verificationClaim =
          api.loginConsentUi.beginProvisioningRequestVerification(
            capability,
            request
          );
      }

      const verification =
        await api.native.verusid.login.verify_request(request);
      if (verificationClaim != null && verification.verified === true) {
        verificationClaim.confirm();
      }
      res.send(
        JSON.stringify({
          msg: "success",
          result: verification,
        })
      );
    } catch (e) {
      res.send(
        JSON.stringify({
          msg: "error",
          result: e.message,
        })
      );
    } finally {
      if (verificationClaim != null) verificationClaim.release();
    }
  });

  return api;
};
