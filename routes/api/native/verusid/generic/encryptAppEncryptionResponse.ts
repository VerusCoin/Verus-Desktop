import {
  AppEncryptionResponseDetails,
  AppEncryptionResponseDetailsJson,
  DataDescriptor,
} from 'verus-typescript-primitives';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default (api: any) => {
  api.native.verusid.generic.encrypt_app_encryption_response = async (
    coin: string,
    detail: AppEncryptionResponseDetails,
    identity: string,
    zaddress: string
  ) => {
    const signdataResult = await api.native.sign_data(coin, {
      address: identity,
      messagehex: detail.toBuffer().toString('hex'),
      encrypttoaddress: zaddress,
    });

    const encryptedDescriptor = signdataResult.mmrdescriptor_encrypted;

    if (
      !encryptedDescriptor ||
      !encryptedDescriptor.datadescriptors ||
      encryptedDescriptor.datadescriptors.length === 0
    ) {
      throw new Error('No encrypted data descriptor returned from signdata.');
    }

    const dataDescriptor = DataDescriptor.fromJson(encryptedDescriptor.datadescriptors[0]);

    return dataDescriptor.toJson();
  };

  api.setPost(
    '/native/verusid/generic/encrypt_app_encryption_response',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (req: any, res: any) => {
      const {chainTicker, detailJSON, identity, zaddress} = req.body;

      try {
        const detail = AppEncryptionResponseDetails.fromJson(
          detailJSON as AppEncryptionResponseDetailsJson
        );

        const result = await api.native.verusid.generic.encrypt_app_encryption_response(
          chainTicker,
          detail,
          identity,
          zaddress
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
