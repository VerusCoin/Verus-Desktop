import {IdentityUpdateRequestDetails} from 'verus-typescript-primitives';
import {encryptCredentialsInContentMultiMap} from '../../../utils/credentials/encryptCredentials';
import {ZGetEncryptionAddressArgs, ZGetEncryptionAddressResult} from '../../zgetencryptionaddress';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
module.exports = (api: any) => {
  api.native.verusid.identity.execute_identity_update_request = async (
    coin: string,
    detail: IdentityUpdateRequestDetails
  ) => {
    // Replace any values that need to be encrypted before updating the identity.
    if (!detail.identity) {
      throw new Error('IdentityUpdateRequest does not contain an identity.');
    }

    // Change the identity name in the detail to include `@` at the end so that it is valid.
    detail.identity.name = detail.identity.name + '@';
    const address = detail.identity.name;
    const identity = await api.native.get_identity(coin, detail.identity.name);
    const zaddress = identity.identity.privateaddress;

    if (!zaddress) {
      throw new Error(`No z-address found for identity ${address}`);
    }

    const args: ZGetEncryptionAddressArgs = {
      address: zaddress,
      fromid: address,
      toid: address,
    };

    // Generate the viewing key and encryption address to encrypt the credentials.
    const encryptionAddressInfo: ZGetEncryptionAddressResult =
      await api.native.z_get_encryption_address(coin, args);

    if (!encryptionAddressInfo || !encryptionAddressInfo.address || !encryptionAddressInfo.ivk) {
      throw new Error(`Failed to get the personal encryption address for ${address}`);
    }

    const contentmultimap = detail.identity.content_multimap;

    if (contentmultimap) {
      await encryptCredentialsInContentMultiMap(
        api,
        coin,
        address,
        contentmultimap,
        encryptionAddressInfo.ivk,
        encryptionAddressInfo.address
      );
    }

    const txid = await api.native.update_identity(coin, detail.toCLIJson());

    return {txid: txid};
  };

  api.setPost(
    '/native/verusid/identity/execute_identity_update_request',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (req: any, res: any) => {
      const {chainTicker, detailJSON} = req.body;

      try {
        const detail = IdentityUpdateRequestDetails.fromJson(detailJSON);

        res.send(
          JSON.stringify({
            msg: 'success',
            result: await api.native.verusid.identity.execute_identity_update_request(
              chainTicker,
              detail
            ),
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
