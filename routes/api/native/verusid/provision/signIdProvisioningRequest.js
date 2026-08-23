const { VerusIDSignature, IDENTITY_AUTH_SIG_VDXF_KEY } = require("verus-typescript-primitives");
const { ProvisioningRequest } = require("verus-typescript-primitives/dist/vdxf/classes/provisioning/ProvisioningRequest");

module.exports = (api) => {
  /**
   * Signs a provisioning request using an r-address.
   * 
   * @param {String} coin The chainTicker of the coin to make the call on
   * @param {String} request The provisioning request to sign
   * @param {String} raddress The raddress to sign the provioning requset with
   */
  api.native.verusid.provision.sign_id_provisioning_request = async (coin, request, raddress) => {

    const provisioningRequest = new ProvisioningRequest(request);

    const signdataResult = await api.native.sign_data(coin,
      {
        "address": raddress,
        "datahash": provisioningRequest.challenge.toSha256().toString("hex")
      }
    )

    provisioningRequest.signature = new VerusIDSignature(
      { signature: signdataResult.signature },
      IDENTITY_AUTH_SIG_VDXF_KEY
    );

    return provisioningRequest;
  }

  api.setPost('/native/verusid/provision/sign_id_provisioning_request', async (req, res, next) => {
    const {
      chainTicker,
      request,
      raddress,
      capability,
    } = req.body;

    const loginConsentCaller =
      req.api_header != null &&
      req.api_header.builtin === true &&
      req.api_header.app_id === "VERUS_LOGIN_CONSENT_UI";
    let signingClaim = null;

    try {
      if (loginConsentCaller) {
        if (
          api.loginConsentUi == null ||
          typeof api.loginConsentUi.beginProvisioningSigning !== "function"
        ) {
          throw new Error("Login Consent provisioning authorization is unavailable");
        }
        signingClaim = api.loginConsentUi.beginProvisioningSigning(
          capability,
          request,
          raddress
        );
      }

      const signedRequest =
        await api.native.verusid.provision.sign_id_provisioning_request(
          chainTicker,
          request,
          raddress
        );
      if (signingClaim != null) signingClaim.register(signedRequest);

      res.send(
        JSON.stringify({
          msg: "success",
          result: signedRequest,
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
      if (signingClaim != null) signingClaim.release();
    }
  });

  return api;
}
