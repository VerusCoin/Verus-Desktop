const { IdentityUpdateRequest } = require("verus-typescript-primitives")
const { encryptCredentialsInContentMultiMap } = require("../../../utils/credentials/encryptCredentials")

module.exports = (api) => {
  api.native.verusid.identity.execute_identity_update_request = async (coin, request) => {
    const identityUpdateRequest = IdentityUpdateRequest.fromJson(request);

    // Replace any values that need to be encrypted before updating the identity.
    if (!identityUpdateRequest.details.identity) {
      throw new Error("IdentityUpdateRequest does not contain an identity.");
    }

    const address = identityUpdateRequest.details.identity.name;
    const identity = await api.native.get_identity(coin, identityUpdateRequest.details.identity.name);
    const zaddress = identity.identity.privateaddress;
    
    if (!zaddress) {
      throw new Error(`No z-address found for identity ${address}`);
    }

    // Generate the viewing key and encryption address to encrypt the credentials.
    const encryptionAddressInfo = await api.native.z_get_encryption_address(
      coin, 
      {
        address: zaddress,
        fromid: address,
        toid: address
      }
    );

    if (!encryptionAddressInfo || !encryptionAddressInfo.extendedviewingkey || !encryptionAddressInfo.address) {
      throw new Error(`Failed to get the personal encryption address for ${address}`);
    }

    const contentmultimap = identityUpdateRequest.details.identity.content_multimap;

    if (contentmultimap) {
      await encryptCredentialsInContentMultiMap(
        api,
        coin,
        address,
        contentmultimap,
        encryptionAddressInfo.extendedviewingkey,
        encryptionAddressInfo.address
      );
    }

    const txid = await api.native.update_identity(
      coin,
      identityUpdateRequest.details.toCLIJson()
    );

    return { txid: txid };
  };

  api.setPost("/native/verusid/identity/execute_identity_update_request", async (req, res, next) => {
    const { chainTicker, request } = req.body;

    try {
      res.send(
        JSON.stringify({
          msg: "success",
          result: await api.native.verusid.identity.execute_identity_update_request(chainTicker, request),
        })
      );
    } catch (e) {
      res.send(
        JSON.stringify({
          msg: "error",
          result: e.message,
        })
      );
    }
  });

  return api;
};
