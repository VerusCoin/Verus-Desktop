const {
  DATA_TYPE_OBJECT_DATADESCRIPTOR,
  fromBase58Check,
  IDENTITY_CREDENTIALS,
} = require("verus-typescript-primitives");
const { parseCredential } = require("../../utils/credentials/parseCredential");

module.exports = (api) => {
  /**
   * Extracts and decrypts the list of credentials in the given identity
   * 
   * @param {String} coin The chainTicker of the coin to make the call on
   * @param {String} address The identity or address to get the credentials from
   */
  api.native.get_credentials_list = async (
    coin,
    address
  ) => {
    // Get the z-address and contentmultimap from the address.
    const identity = await api.native.get_identity_content(coin, address);
    
    if (!identity || !identity.identity) {
      throw new Error(`Identity not found for ${address}`);
    }

    const zaddress = identity.identity.privateaddress;
    
    if (!zaddress) {
      throw new Error(`No z-address found for identity ${address}`);
    }
    
    // Generate the viewing key to decrypt the credentials.
    const keys = await api.native.z_get_encryption_address(
      coin, 
      {
        address: zaddress,
        fromid: address,
        toid: address
      }
    );
    
    if (!keys || !keys.extendedviewingkey || !keys.ivk) {
      throw new Error(`Failed to get keys for ${address}`);
    }
    
    const evk = keys.extendedviewingkey;
    const ivk = keys.ivk;
    
    // Generate the credential key using the ivk.
    const credentialKeyResult = await api.native.get_vdxf_id(
      coin,
      IDENTITY_CREDENTIALS.vdxfid, 
      { uint256: ivk }
    );
    
    if (!credentialKeyResult || !credentialKeyResult.vdxfid) {
      throw new Error("Failed to generate credential key");
    }
    
    const credentialKey = credentialKeyResult.vdxfid;
    
    if (!identity.identity.contentmultimap || !identity.identity.contentmultimap[credentialKey]) {
      return [];
    }

    const credentialEntries = identity.identity.contentmultimap[credentialKey];
    const credentials = [];
    
    for (const entry of credentialEntries) {
      // Convert single univalues to an array to make the processing consistent.
      const entriesToProcess = Array.isArray(entry) ? entry : [entry];
      
      for (const singleEntry of entriesToProcess) {
        if (singleEntry[DATA_TYPE_OBJECT_DATADESCRIPTOR.vdxfid]) {
          const dataDescriptor = singleEntry[DATA_TYPE_OBJECT_DATADESCRIPTOR.vdxfid];
          
          try {
            const decryptedData = await api.native.decrypt_data(
              coin,
              {
                datadescriptor: dataDescriptor,
                evk: evk
              }
            );
            
            // The data descriptor is in a list.
            if (decryptedData && Array.isArray(decryptedData)) {
              const credObj = decryptedData[0];
              const cred = parseCredential(credObj);
              credentials.push(cred);
            }
          } catch (err) {
            console.error(`Failed to decrypt credential: ${err.message}`);
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
   * @param {String} coin The chainTicker of the coin to make the call on
   * @param {String} address The identity or address to get the credentials from
   */
  api.native.get_credentials_map = async (
    coin,
    address
  ) => {
    // Get the list of credentials.
    const credentialsList = await api.native.get_credentials_list(coin, address);
    
    const credentialsMap = {};
    
    // Track seen credential keys by scope to avoid duplicates.
    const seenCredentials = {};
    
    // Process each credential and organize by the main scope in reverse order so 
    // the newest credentials are first.
    for (let i = credentialsList.length - 1; i >= 0; i--) {
      const credential = credentialsList[i];
      
      // Try to convert the main scope into an i-address, if it isn't one already.
      let mainScope = credential.scopes[0];
      try {
        fromBase58Check(scope);
      } catch {
        try {
          const scopeId = await api.native.get_identity(coin, mainScope);
          if (scopeId && scopeId.identity && scopeId.identity.identityaddress) {
            mainScope = scopeId.identity.identityaddress;
          }
          // If there is an error getting the identity, then the scope is not an identity.
          // In that case, just leave the scope as is.
        } catch {}
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
   * Creates a map of credentials organized by scope
   * 
   * @param {String} coin The chainTicker of the coin to make the call on
   * @param {String} address The identity or address to get the credentials from
   * @param {String} scope The scope of the credentials to get
   * @param {string[]} credentialKeys - Optional list of credential keys to filter the result by
   */

  api.native.get_credentials_by_scope = async (
    coin,
    address,
    scope,
    credentialKeys
  ) => {
    const credentialsMap = await api.native.get_credentials_map(coin, address);
    const scopeCredentials = credentialsMap[scope] || [];
    
    if (!credentialKeys || credentialKeys.length === 0) {
      return scopeCredentials;
    }

    return scopeCredentials.filter(cred => 
      credentialKeys.includes(cred.credentialKey)
    );
  };

  api.setPost("/native/get_credentials_by_scope", async (req, res, next) => {
    const { 
      coin,
      address,
      scope,
      credentialKeys
    } = req.body;

    api.native
      .get_credentials_by_scope(
        coin,
        address,
        scope,
        credentialKeys
      )
      .then(resultObj => {
      const retObj = {
        msg: "success",
        result: resultObj
      };

      res.send(JSON.stringify(retObj));
      })
      .catch(error => {
      const retObj = {
        msg: "error",
        result: error.message
      };

      res.send(JSON.stringify(retObj));
      });
  });

  return api;
};
