const axios = require('axios');
const {
  LOGIN_CONSENT_RESPONSE_VDXF_KEY,
  LOGIN_CONSENT_WEBHOOK_VDXF_KEY,
  LOGIN_CONSENT_REDIRECT_VDXF_KEY,
  LoginConsentResponse,
  IDENTITY_UPDATE_RESPONSE_VDXF_KEY,
  ResponseUri,
} = require("verus-typescript-primitives");
const { pushMessage } = require('../../../ipc/ipc');
const { ReservedPluginTypes } = require('../../utils/plugin/builtin');
const { shell } = require('electron')
const { URL } = require('url');
const base64url = require('base64url');

module.exports = (api) => {
  api.loginConsentUi = {}

  api.loginConsentUi.handle_redirect = (responseKey, response, redirectinfo) => {
    const { type, uri } = redirectinfo;

    let processedType = type;

    // Type can either be a string vdxfkey or a BN converted into a number.
    const usesResponseUri = responseKey === IDENTITY_UPDATE_RESPONSE_VDXF_KEY.vdxfid;
    if (usesResponseUri) {
      const responseUri = ResponseUri.fromJson(redirectinfo);
      processedType = responseUri.type;
    }

    const post = async () => {
      // Add a slight delay to allow the user to see the desktop GUI briefly.
      setTimeout(() => {
        api.minimizeApp();
      }, 250);

      let result
      try {
        result = await axios.post(
          uri,
          response
        );
      } catch (e) {
        console.error(`Failed to post to webhook ${e}`)
      }
      
      return result;
    };

    const redirect = async () => {
      const url = new URL(uri);

      // Prevent opening any urls that don't go to the browser for security reasons.
      if (!['https:', 'http:'].includes(url.protocol)) {
        return null;
      }

      let res;

      switch (responseKey) {
        case LOGIN_CONSENT_RESPONSE_VDXF_KEY.vdxfid:
          res = new LoginConsentResponse(response)
          break;

        case IDENTITY_UPDATE_RESPONSE_VDXF_KEY.vdxfid:
          // Always convert from JSON when handling Identity Update Responses
          // since they need to be sent as JSON from the plugin to avoid
          // issues with the response being malformed.
          res = IdentityUpdateResponse.fromJson(response);
          break;

        default:
          throw new Error(`Unsupported response key for redirecting: ${responseKey}`);
      }

      url.searchParams.set(
        responseKey,
        base64url(res.toBuffer())
      );

      shell.openExternal(url.toString());
      return null;
    };

    const handlers = {
      [LOGIN_CONSENT_WEBHOOK_VDXF_KEY.vdxfid]: post,
      [LOGIN_CONSENT_REDIRECT_VDXF_KEY.vdxfid]: redirect,
      [ResponseUri.TYPE_POST]: post,
      [ResponseUri.TYPE_REDIRECT]: redirect,
    };

    return handlers[processedType] == null ? null : handlers[processedType]();
  }

  api.loginConsentUi.deeplink = async (
    deeplink,
    originInfo
  ) => {
    return new Promise((resolve, reject) => {
      try {
        api.startPlugin(
          ReservedPluginTypes.VERUS_LOGIN_CONSENT_UI,
          true,
          (data) => {
            try {
              if (data.redirect) {
                api.loginConsentUi.handle_redirect(
                  data.responseKey,
                  data.response,
                  data.redirect
                );
              } 
              resolve(data.response);
            } catch(e) {
              reject(e)
            }
          },
          (pluginWindow) => {
            pushMessage(
              pluginWindow,
              {
                deeplink: deeplink,
                origin_app_info: originInfo,
              },
              "VERUS_LOGIN_CONSENT_REQUEST"
            );
          },
          830,
          550,
          false
        );
      } catch (e) {
        reject(e);
      }
    });
  };

  api.setPost('/plugin/builtin/verus_login_consent_ui/request', async (req, res, next) => {
    const { request } = req.body;
    const { app_id, builtin } = req.api_header
   
    try {
      const retObj = {
        msg: "success",
        result: await api.loginConsentUi.deeplink(
          request,
          {
            id: app_id,
            search_builtin: builtin,
          }
        ),
      };

      res.send(JSON.stringify(retObj));
    } catch (e) {
      const retObj = {
        msg: 'error',
        result: e.message,
      };

      res.send(JSON.stringify(retObj));
    }
  });

  return api;
};