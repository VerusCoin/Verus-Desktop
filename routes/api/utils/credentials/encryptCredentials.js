const {
  IDENTITY_CREDENTIALS,
  DATA_TYPE_OBJECT_CREDENTIAL,
  DataDescriptor,
  DATA_TYPE_OBJECT_DATADESCRIPTOR
} = require('verus-typescript-primitives');

const encryptCredentialsInContentMultiMap = async (
  api,
  coin,
  address,
  contentmultimap,
  viewingKey,
  encryptionAddress
) => {
  for (const [key, valueArray] of contentmultimap.kv_content.entries()) {
    if (key === IDENTITY_CREDENTIALS.vdxfid) {
      console.log("Found IDENTITY_CREDENTIALS key:", key);
      
      for (let i = 0; i < valueArray.length; i++) {
        const vdxfUniValue = valueArray[i];
        for (const valueObj of vdxfUniValue.values) {
          // Each valueObj contains exactly one key-value pair.
          const valueKey = Object.keys(valueObj)[0];
          
          if (valueKey === DATA_TYPE_OBJECT_CREDENTIAL.vdxfid) {
            // Replace the credential with the encrypted data descriptor.
            const vdxfUniType = valueObj[valueKey];

            const signdataResult = await api.native.sign_data(coin,
              {
                "address": address,
                "vdxfdata": {[valueKey]: vdxfUniType.toJson()},
                "encrypttoaddress": encryptionAddress
              }
            );

            const dataDescriptor = DataDescriptor.fromJson(signdataResult.mmrdescriptor_encrypted.datadescriptors[0]);
            delete valueObj[valueKey];
            valueObj[DATA_TYPE_OBJECT_DATADESCRIPTOR.vdxfid] = dataDescriptor;
          }
        }
      }
      // Replace the credentials key with an obfuscated key.
      const credentialKeyResult = await api.native.get_vdxf_id(
        coin,
        "vrsc::identity.credentials", 
        { vdxfkey: viewingKey }
      );
      
      if (!credentialKeyResult || !credentialKeyResult.vdxfid) {
        throw new Error("Failed to generate credential key");
      }
      
      const credentialKey = credentialKeyResult.vdxfid;
      
      contentmultimap.kv_content.set(credentialKey, valueArray);
      contentmultimap.kv_content.delete(IDENTITY_CREDENTIALS.vdxfid);
    }
  }
};

module.exports = {
  encryptCredentialsInContentMultiMap
};
