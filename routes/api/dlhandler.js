const { LOGIN_CONSENT_REQUEST_VDXF_KEY, LoginConsentRequest } = require('verus-typescript-primitives');
const base64url = require("base64url");

module.exports = (api) => {
  api.dlhandler = (url) => {
    const handlers = {
      [LOGIN_CONSENT_REQUEST_VDXF_KEY.vdxfid]: (url) => {
        const value = url.searchParams.get(LOGIN_CONSENT_REQUEST_VDXF_KEY.vdxfid)
        const req = new LoginConsentRequest();
        req.fromBuffer(base64url.toBuffer(value));

        return api.loginConsentUi.request(
          req.toJson(),
          {
            id: "VERUS_DESKTOP_MAIN",
            search_builtin: true,
            main_chain_ticker: "VRSC"
          }
        )
      }
    }

    return handlers[url.pathname.replace(/\//g, "")](url)
  }

  return api;
};