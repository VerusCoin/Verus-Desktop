const {
  LOGIN_CONSENT_REQUEST_VDXF_KEY,
  LoginConsentRequest,
  VERUSPAY_INVOICE_VDXF_KEY,
  VerusPayInvoice,
  IDENTITY_UPDATE_REQUEST_VDXF_KEY,
  IdentityUpdateRequest,
  DEEPLINK_PROTOCOL_URL_CURRENT_VERSION,
  GenericRequest
} = require('verus-typescript-primitives');
const base64url = require("base64url");
const { ROOT_SYSTEM_NAME } = require('./utils/constants/dev_options');
const { SUPPORTED_DLS, CALLBACK_HOST } = require('./utils/constants/supported_dls');

module.exports = (api) => {
  api.dlhandler = (urlstring) => {
    const deeplinkHandler = (urlstring) => {
      const url = new URL(urlstring);

      let dl;
      let id;

      // Handle v1 and v2 requests separately.
      if (url.host === CALLBACK_HOST) {
        id = url.pathname.split('/')[1];

        if (!SUPPORTED_DLS.includes(id)) {
          throw new Error('Unsupported deeplink url path.');
        }

        switch (id) {
          case LOGIN_CONSENT_REQUEST_VDXF_KEY.vdxfid:
            dl = LoginConsentRequest.fromWalletDeeplinkUri(urlstring);
            break;

          case VERUSPAY_INVOICE_VDXF_KEY.vdxfid:
            dl = VerusPayInvoice.fromWalletDeeplinkUri(urlstring);
            break;

          case IDENTITY_UPDATE_REQUEST_VDXF_KEY.vdxfid:
            dl = IdentityUpdateRequest.fromWalletDeeplinkUri(urlstring);
            break;
            
          default:
            throw new Error(`Unsupported deeplink ID: ${urlstring}`);
        }
      } else {
        dl = GenericRequest.fromWalletDeeplinkUri(urlstring);
        id = DEEPLINK_PROTOCOL_URL_CURRENT_VERSION.toString();
      }

      return api.loginConsentUi.deeplink(
        {
          id: id,
          data: dl.toJson()
        },
        {
          id: "VERUS_DESKTOP_MAIN",
          search_builtin: true,
          main_chain_ticker: ROOT_SYSTEM_NAME
        }
      );
    };

    return deeplinkHandler(urlstring);
  }

  return api;
};