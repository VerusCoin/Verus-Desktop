import {AppEncryptionRequestDetails} from 'verus-typescript-primitives';

import {ZGetEncryptionAddressArgs, ZGetEncryptionAddressResult} from '../../zgetencryptionaddress';

interface AppEncryptionResult {
  incomingViewingKey: string;
  extendedViewingKey: string;
  address: string;
  extendedSpendingKey?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default (api: any) => {
  api.native.verusid.generic.execute_app_encryption_request = async (
    coin: string,
    detail: AppEncryptionRequestDetails,
    fromID: string,
    toID: string
  ): Promise<AppEncryptionResult> => {
    const walletinfo = await api.native.callDaemon(coin, 'getwalletinfo', []);

    if (!walletinfo.seedfp) {
      throw new Error('No seedfp found in walletinfo.');
    }

    const seed = walletinfo.seedfp;

    const args: ZGetEncryptionAddressArgs = {
      seed: seed,
      hdindex: detail.derivationNumber.toNumber(),
      fromid: fromID,
      toid: toID,
      returnsecret: detail.returnESK(detail.flags),
    };

    const keys: ZGetEncryptionAddressResult = await api.native.z_get_encryption_address(coin, args);

    return {
      extendedViewingKey: keys.extendedviewingkey,
      incomingViewingKey: keys.ivk,
      address: keys.address,
      extendedSpendingKey: keys?.extendedspendingkey,
    };
  };

  api.setPost(
    '/native/verusid/generic/execute_app_encryption_request',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (req: any, res: any) => {
      const {chainTicker, detailJSON, fromID, toID} = req.body;

      try {
        const detail = AppEncryptionRequestDetails.fromJson(detailJSON);

        const result = await api.native.verusid.generic.execute_app_encryption_request(
          chainTicker,
          detail,
          fromID,
          toID
        );

        res.send(
          JSON.stringify({
            msg: 'success',
            result: result,
          })
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        res.send(
          JSON.stringify({
            msg: 'error',
            result: message,
          })
        );
      }
    }
  );

  return api;
};
