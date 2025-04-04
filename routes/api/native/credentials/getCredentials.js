const {
  DATA_TYPE_OBJECT_DATADESCRIPTOR,
  fromBase58Check,
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
    // Get the z-address and contentmultimap from the address
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
    
    if (!keys || !keys.extendedviewingkey) {
      throw new Error(`Failed to get keys for ${address}`);
    }
    
    const viewingKey = keys.extendedviewingkey;
    
    // Generate the credential key using the viewing key
    const credentialKeyResult = await api.native.get_vdxf_id(
      coin,
      "vrsc::identity.credentials", 
      { vdxfkey: viewingKey }
    );
    
    if (!credentialKeyResult || !credentialKeyResult.vdxfid) {
      throw new Error("Failed to generate credential key");
    }
    
    const credentialKey = credentialKeyResult.vdxfid;
    
    // Check if the identity has credentials in its content multimap.
    if (!identity.identity.contentmultimap || !identity.identity.contentmultimap[credentialKey]) {
      return []; // No credentials found.
    }

    const credentialEntries = identity.identity.contentmultimap[credentialKey];
    const credentials = [];
    
    for (const entry of credentialEntries) {
      if (entry[DATA_TYPE_OBJECT_DATADESCRIPTOR.vdxfid]) {
        const dataDescriptor = entry[DATA_TYPE_OBJECT_DATADESCRIPTOR.vdxfid];
        
        // Decrypt the data descriptor using the viewing key.
        try {
          const decryptedData = await api.native.decrypt_data(
            coin,
            {
              datadescriptor: dataDescriptor,
              evk: viewingKey
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
    
    // Process each credential and organize by scope.
    for (const credential of credentialsList) {
      
      // Try to convert the scope into an i-address, if it isn't one already.
      let scope = credential.scopes;
      try {
        fromBase58Check(scope);
      } catch {
        try {
          const scopeId = await api.native.get_identity(coin, credential.scopes);
          if (scopeId && scopeId.identity && scopeId.identity.identityaddress) {
            scope = scopeId.identity.identityaddress;
          }
          // If there is an error getting the identity, then the scope is not an identity.
          // In that case, just leave the scope as is.
        } catch {}
      }

      const credentialKey = credential.credentialKey;
      
      if (!credentialsMap[scope]) {
        credentialsMap[scope] = [];
      }
      
      // Using a set to track duplicates for efficient lookup.
      if (!seenCredentials[scope]) {
        seenCredentials[scope] = new Set();
      }
      
      // Skip duplicate credentials that come later since they are 
      // the previous credentials for that scope.
      if (!seenCredentials[scope].has(credentialKey)) {
        credentialsMap[scope].push(credential);
        seenCredentials[scope].add(credentialKey);
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
   */

  api.native.get_credentials_by_scope = async (
    coin,
    address,
    scope
  ) => {
    const credentialsMap = await api.native.get_credentials_map(coin, address);
    
    return credentialsMap[scope];
  };

  api.setPost("/native/get_credentials_by_scope", async (req, res, next) => {
    const { 
      coin,
      address,
      scope 
    } = req.body;

    api.native
      .get_credentials_by_scope(
        coin,
        address,
        scope
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
