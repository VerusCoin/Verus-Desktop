import {AppEncryptionRequestDetails} from 'verus-typescript-primitives';

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
    const seed = walletinfo.seedfp;

    // TODO: Add fetching returnsecret via RETURN_ESK from the detail
    // once it is able to be handled.

    const keys = await api.native.z_get_encryption_address(coin, {
      seed: seed,
      hdindex: detail.derivationNumber.toNumber(),
      fromid: fromID,
      toid: toID,
    });

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
        res.send(
          JSON.stringify({
            msg: 'error',
            result: e.message,
          })
        );
      }
    }
  );

  return api;
};
