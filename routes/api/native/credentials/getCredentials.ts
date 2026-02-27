import {
  DATA_DESCRIPTOR_VDXF_KEY,
  IDENTITY_CREDENTIAL,
  fromBase58Check,
  Credential,
  DATA_TYPE_OBJECT_CREDENTIAL,
} from 'verus-typescript-primitives';

interface EncryptionKeys {
  extendedviewingkey: string;
  ivk: string;
}

interface VdxfIdResult {
  vdxfid: string;
}

interface IdentityContent {
  identity: {
    privateaddress?: string;
    contentmultimap?: Record<
      string,
      Array<Record<string, unknown> | Array<Record<string, unknown>>>
    >;
    identityaddress?: string;
  };
}

interface CredentialsMap {
  [scope: string]: Credential[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default (api: any) => {
  /**
   * Extracts and decrypts the list of credentials in the given identity
   *
   * @param coin The chainTicker of the coin to make the call on
   * @param address The identity or address to get the credentials from
   */
  api.native.get_credentials_list = async (
    coin: string,
    address: string
  ): Promise<Credential[]> => {
    // Get the z-address and contentmultimap from the address.
    const identity: IdentityContent | null = await api.native.get_identity_content(coin, address);

    if (!identity || !identity.identity) {
      throw new Error(`Identity not found for ${address}`);
    }

    const zaddress = identity.identity.privateaddress;

    if (!zaddress) {
      throw new Error(`No z-address found for identity ${address}`);
    }

    // Generate the viewing key to decrypt the credentials.
    const keys: EncryptionKeys | null = await api.native.z_get_encryption_address(coin, {
      address: zaddress,
      fromid: address,
      toid: address,
    });

    if (!keys || !keys.extendedviewingkey || !keys.ivk) {
      throw new Error(`Failed to get keys for ${address}`);
    }

    const evk = keys.extendedviewingkey;
    const ivk = keys.ivk;

    // Generate the credential key using the ivk.
    const credentialKeyResult: VdxfIdResult | null = await api.native.get_vdxf_id(
      coin,
      IDENTITY_CREDENTIAL.vdxfid,
      {uint256: ivk}
    );

    if (!credentialKeyResult || !credentialKeyResult.vdxfid) {
      throw new Error('Failed to generate credential key');
    }

    const credentialKey = credentialKeyResult.vdxfid;

    if (!identity.identity.contentmultimap || !identity.identity.contentmultimap[credentialKey]) {
      return [];
    }

    const credentialEntries = identity.identity.contentmultimap[credentialKey];
    const credentials: Credential[] = [];

    for (const entry of credentialEntries) {
      // Convert single univalues to an array to make the processing consistent.
      const entriesToProcess: Array<Record<string, unknown>> = Array.isArray(entry)
        ? entry
        : [entry];

      for (const singleEntry of entriesToProcess) {
        if (singleEntry[DATA_DESCRIPTOR_VDXF_KEY.vdxfid]) {
          const dataDescriptor = singleEntry[DATA_DESCRIPTOR_VDXF_KEY.vdxfid];

          try {
            const decryptedData = await api.native.decrypt_data(coin, {
              datadescriptor: dataDescriptor,
              evk: evk,
            });

            // The data descriptor is in a list.
            if (decryptedData && Array.isArray(decryptedData)) {
              const credObj = decryptedData[0] as Record<string, unknown>;
              const credJson = credObj[DATA_TYPE_OBJECT_CREDENTIAL.vdxfid];
              const cred = Credential.fromJson(
                credJson as Parameters<typeof Credential.fromJson>[0]
              );
              credentials.push(cred);
            }
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`Failed to decrypt credential: ${message}`);
            // Decrypt the other credentials even if one fails.
          }
        }
      }
    }

    return credentials;
  };

  /**
   * Creates a map of credentials organized by scope
   *
   * @param coin The chainTicker of the coin to make the call on
   * @param address The identity or address to get the credentials from
   */
  api.native.get_credentials_map = async (
    coin: string,
    address: string
  ): Promise<CredentialsMap> => {
    // Get the list of credentials.
    const credentialsList: Credential[] = await api.native.get_credentials_list(coin, address);

    const credentialsMap: CredentialsMap = {};

    // Track seen credential keys by scope to avoid duplicates.
    const seenCredentials: Record<string, Set<string>> = {};

    // Process each credential and organize by the main scope in reverse order so
    // the newest credentials are first.
    for (let i = credentialsList.length - 1; i >= 0; i--) {
      const credential = credentialsList[i];

      // Try to convert the main scope into an i-address, if it isn't one already.
      let mainScope = credential.scopes[0] as string;
      try {
        fromBase58Check(mainScope);
      } catch {
        try {
          const scopeId = await api.native.get_identity(coin, mainScope);
          if (scopeId && scopeId.identity && scopeId.identity.identityaddress) {
            mainScope = scopeId.identity.identityaddress;
          }
          // If there is an error getting the identity, then the scope is not an identity.
          // In that case, just leave the scope as is.
        } catch {
          // Scope is not an identity, leave as is.
        }
      }

      const credentialKey = credential.credentialKey;

      if (!credentialsMap[mainScope]) {
        credentialsMap[mainScope] = [];
      }

      if (!seenCredentials[mainScope]) {
        seenCredentials[mainScope] = new Set();
      }

      // Skip duplicate credentials that come later since they are
      // the previous credentials for that scope.
      if (!seenCredentials[mainScope].has(credentialKey)) {
        credentialsMap[mainScope].push(credential);
        seenCredentials[mainScope].add(credentialKey);
      }
    }

    return credentialsMap;
  };

  /**
   * Gets credentials filtered by scope and optionally by credential keys
   *
   * @param coin The chainTicker of the coin to make the call on
   * @param address The identity or address to get the credentials from
   * @param scope The scope of the credentials to get
   * @param credentialKeys Optional list of credential keys to filter the result by
   */
  api.native.get_credentials_by_scope = async (
    coin: string,
    address: string,
    scope: string,
    credentialKeys?: string[]
  ): Promise<Credential[]> => {
    const credentialsMap = await api.native.get_credentials_map(coin, address);
    const scopeCredentials = credentialsMap[scope] || [];

    if (!credentialKeys || credentialKeys.length === 0) {
      return scopeCredentials;
    }

    return scopeCredentials.filter((cred: Credential) =>
      credentialKeys.includes(cred.credentialKey)
    );
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api.setPost('/native/get_credentials_by_scope', async (req: any, res: any) => {
    const {coin, address, scope, credentialKeys} = req.body;

    try {
      const result = await api.native.get_credentials_by_scope(
        coin,
        address,
        scope,
        credentialKeys
      );

      res.send(
        JSON.stringify({
          msg: 'success',
          result: result,
        })
      );
    } catch (e: unknown) {
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
