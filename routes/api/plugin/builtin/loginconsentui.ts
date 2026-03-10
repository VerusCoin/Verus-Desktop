import axios, {AxiosResponse} from 'axios';
import base64url from 'base64url';
import {BrowserWindow, shell} from 'electron';
import {
  GENERIC_ENVELOPE_DEEPLINK_VDXF_KEY,
  LOGIN_CONSENT_REDIRECT_VDXF_KEY,
  LOGIN_CONSENT_RESPONSE_VDXF_KEY,
  LOGIN_CONSENT_WEBHOOK_VDXF_KEY,
  LoginConsentResponse,
  ResponseURI,
} from 'verus-typescript-primitives';

import {pushMessage} from '../../../ipc/ipc';
import {ReservedPluginTypes} from '../../utils/plugin/builtin';

interface RedirectInfo {
  type: string;
  uri: string;
}

interface OriginInfo {
  id: string;
  search_builtin: boolean;
}

interface ResponseURIJson {
  type: string;
  uri: string;
}

interface SingleURIResult {
  type: 'v1';
  responseKey: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  response: any;
  redirect: RedirectInfo;
}

interface MultiURIResult {
  type: 'v2';
  response: string;
  uris: ResponseURIJson[];
}

type DeeplinkResponse = SingleURIResult | MultiURIResult | {error: string};

interface RequestBody {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  request: any;
}

interface ApiHeader {
  app_id: string;
  builtin: boolean;
}

interface Request {
  body: RequestBody;
  api_header: ApiHeader;
}

interface Response {
  send: (data: string) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyApi = any;

// Temporary typing before the rest of the project is converted.
interface Api {
  loginConsentUi: {
    handle_redirect: (
      responseKey: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      response: any,
      redirectinfo: RedirectInfo
    ) => Promise<AxiosResponse | null> | null;
    handle_multi_uris: (
      responseKey: string,
      response: string,
      uris: ResponseURIJson[]
    ) => Promise<void>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deeplink: (deeplink: any, originInfo: OriginInfo) => Promise<any>;
  };
  minimizeApp: () => void;
  startPlugin: (
    type: string,
    builtin: boolean,
    onComplete: (data: DeeplinkResponse) => void,
    onFinishLoad: (pluginWindow: BrowserWindow) => void,
    width: number,
    height: number,
    frame: boolean
  ) => void;
  setPost: (path: string, handler: (req: Request, res: Response) => Promise<void>) => void;
}

// Wraps shell.openExternal to prevent opening any urls that don't go to the browser for security reasons.
function safeOpenExternal(url: URL): void {
  if (!['https:', 'http:'].includes(url.protocol)) {
    return;
  }

  try {
    shell.openExternal(url.toString());
  } catch (error) {
    console.error('Failed to open URL:', error);
  }
}

export = (api: AnyApi): Api => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api.loginConsentUi = {} as any;

  // Handles the multiple responses in V2 requests.
  api.loginConsentUi.respond = async (response: string, uris: ResponseURIJson[]): Promise<void> => {
    if (!uris || uris.length === 0) return;

    // Convert JSON objects to ResponseURI instances and find the first POST URI, fallback to REDIRECT
    const responseUris = uris.map(uri => ResponseURI.fromJson(uri));
    const selectedUri =
      responseUris.find(uri => uri.type.eq(ResponseURI.TYPE_POST)) ??
      responseUris.find(uri => uri.type.eq(ResponseURI.TYPE_REDIRECT));

    if (!selectedUri) return;

    // Deserialize the response from hex string to Buffer
    const responseBuffer = Buffer.from(response, 'hex');

    // Handle POST URI
    if (selectedUri.type.eq(ResponseURI.TYPE_POST)) {
      setTimeout(() => {
        api.minimizeApp();
      }, 250);

      const uri = selectedUri.getUriString();

      try {
        await axios.post(uri, responseBuffer, {
          headers: {'Content-Type': 'application/octet-stream'},
        });
      } catch (e) {
        console.error(`Failed to post to webhook ${e}`);
      }
      return;
    }

    // Handle REDIRECT URI
    if (selectedUri.type.eq(ResponseURI.TYPE_REDIRECT)) {
      const url = new URL(selectedUri.getUriString());

      // TODO: Use the response key when the library is updated
      url.searchParams.set(GENERIC_ENVELOPE_DEEPLINK_VDXF_KEY.vdxfid, base64url(responseBuffer));
      safeOpenExternal(url);
    }
  };

  // Handles the old redirect URIs in V1 requests.
  api.loginConsentUi.handle_redirect = (
    responseKey: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    response: any,
    redirectinfo: RedirectInfo
  ): Promise<void> => {
    const {type, uri} = redirectinfo;

    const post = async (): Promise<void> => {
      // Add a slight delay to allow the user to see the desktop GUI briefly.
      setTimeout(() => {
        api.minimizeApp();
      }, 250);

      try {
        await axios.post(uri, response);
      } catch (e) {
        console.error(`Failed to post to webhook ${e}`);
      }

      return;
    };

    const redirect = async (): Promise<void> => {
      const url = new URL(uri);

      let res: LoginConsentResponse;

      switch (responseKey) {
        case LOGIN_CONSENT_RESPONSE_VDXF_KEY.vdxfid:
          res = new LoginConsentResponse(response);
          break;

        default:
          throw new Error(`Unsupported response key for redirecting: ${responseKey}`);
      }

      url.searchParams.set(responseKey, base64url(res.toBuffer()));

      safeOpenExternal(url);
    };

    const handlers: Record<string, () => Promise<void>> = {
      [LOGIN_CONSENT_WEBHOOK_VDXF_KEY.vdxfid]: post,
      [LOGIN_CONSENT_REDIRECT_VDXF_KEY.vdxfid]: redirect,
    };

    return handlers[type]?.() ?? Promise.resolve();
  };

  api.loginConsentUi.deeplink = async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deeplink: any,
    originInfo: OriginInfo
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> => {
    return new Promise((resolve, reject) => {
      api.startPlugin(
        ReservedPluginTypes.VERUS_LOGIN_CONSENT_UI,
        true,
        async (data: DeeplinkResponse) => {
          try {
            if ('error' in data) {
              reject(new Error(data.error));
              return;
            }

            // Handle v2 multi-URI result
            if (data.type === 'v2') {
              await api.loginConsentUi.respond(data.response, data.uris);
            } else if (data.type === 'v1') {
              // Handle v1 single-URI result
              await api.loginConsentUi.handle_redirect(
                data.responseKey,
                data.response,
                data.redirect
              );
            }

            resolve(data.response);
          } catch (e) {
            reject(e);
          }
        },
        (pluginWindow: BrowserWindow) => {
          pushMessage(
            pluginWindow,
            {
              deeplink: deeplink,
              origin_app_info: originInfo,
            },
            'VERUS_LOGIN_CONSENT_REQUEST'
          );
        },
        830,
        550,
        false
      );
    });
  };

  api.setPost(
    '/plugin/builtin/verus_login_consent_ui/request',
    async (req: Request, res: Response) => {
      const {request} = req.body;
      const {app_id, builtin} = req.api_header;

      try {
        const retObj = {
          msg: 'success',
          result: await api.loginConsentUi.deeplink(request, {
            id: app_id,
            search_builtin: builtin,
          }),
        };

        res.send(JSON.stringify(retObj));
      } catch (e) {
        const retObj = {
          msg: 'error',
          result: (e as Error).message,
        };

        res.send(JSON.stringify(retObj));
      }
    }
  );

  return api;
};
