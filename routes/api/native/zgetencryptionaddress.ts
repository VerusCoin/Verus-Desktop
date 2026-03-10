// Temporarily export the interfaces since the API has no defined type yet.
export interface ZGetEncryptionAddressArgs {
  address?: string;
  seed?: string;
  hdindex?: number;
  rootkey?: string;
  fromid?: string;
  toid?: string;
  encryptionindex?: number;
  returnsecret?: boolean;
}

export interface ZGetEncryptionAddressResult {
  extendedviewingkey: string;
  ivk: string;
  address: string;
  extendedspendingkey?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default (api: any) => {
  /**
   * Generates a z-address, viewing key, and optionally an extended secret key using either
   * a z-address in the wallet, wallet seed and hdindex, or root key (extended private key).
   *
   * @param {string} coin The chainTicker of the coin to make the call on
   * @param {ZGetEncryptionAddressArgs} args The arguments to pass to z_getencryptionaddress
   *   - address: z-address that is present in this wallet
   *   - seed: raw wallet seed
   *   - hdindex: address to derive from seed (default=0)
   *   - rootkey: extended private key
   *   - fromid: a key to be used between the fromid and the toid
   *   - toid: a key to be used between the fromid and the toid
   *   - encryptionindex: index to derive the final encryption HD address from the derived seed (default=0)
   *   - returnsecret: if true, returns extended private key (default=false)
   */
  api.native.z_get_encryption_address = async (
    coin: string,
    args: ZGetEncryptionAddressArgs
  ): Promise<ZGetEncryptionAddressResult> => {
    return api.native.callDaemon(coin, 'z_getencryptionaddress', [args]);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api.setPost('/native/z_get_encryption_address', async (req: any, res: any) => {
    const {chainTicker, args}: {chainTicker: string; args: ZGetEncryptionAddressArgs} = req.body;

    try {
      const result = await api.native.z_get_encryption_address(chainTicker, args);

      res.send(
        JSON.stringify({
          msg: 'success',
          result,
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
  });

  return api;
};
