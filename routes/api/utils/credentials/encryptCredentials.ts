import {
  CompactIAddressObject,
  Credential,
  DATA_DESCRIPTOR_VDXF_KEY,
  DATA_TYPE_OBJECT_CREDENTIAL,
  DataDescriptor,
  FqnContentMultiMap,
  FqnVdxfUniValue,
  IDENTITY_CREDENTIAL,
  VdxfUniType,
} from 'verus-typescript-primitives';

interface GetVdxfIdResult {
  vdxfid: string;
  indexid: string;
  hash160result: string;
  qualifiedname: {
    namespace: string;
    name: string;
  };
  bounddata?: {
    vdxfkey: string;
  };
}

// Replaces the credentials in the contentmultimap with their encrypted forms
// in data descriptors.
export async function encryptCredentialsInContentMultiMap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api: any,
  coin: string,
  address: string,
  contentmultimap: FqnContentMultiMap,
  ivk: string,
  encryptionAddress: string
): Promise<void> {
  for (const [key, valueArray] of Array.from(contentmultimap.kvContent.entries())) {
    if (key.toIAddress() === IDENTITY_CREDENTIAL.vdxfid) {
      for (let i = 0; i < valueArray.length; i++) {
        const vdxfUniValue = valueArray[i];
        if (!(vdxfUniValue instanceof FqnVdxfUniValue)) continue;
        // vdxfUniValue.values doesn't work for key comparison since it uses a
        // different method for generating string keys than toIAddress() or toAddress().
        // We also have to completely rebuild the values array since we can't modify
        // it in place.
        const newValues: Array<{[key: string]: VdxfUniType}> = [];
        for (const [valueKey, valueType] of Array.from(vdxfUniValue.entries())) {
          // Each valueObj contains exactly one key-value pair.
          const vdxfkey = valueKey.toAddress();
          if (vdxfkey === DATA_TYPE_OBJECT_CREDENTIAL.vdxfid) {
            // Replace the credential with the encrypted data descriptor.
            const credential = valueType as Credential;

            const signdataResult = await api.native.sign_data(coin, {
              address: address,
              vdxfdata: {[vdxfkey]: credential.toJson()},
              encrypttoaddress: encryptionAddress,
            });

            if (!signdataResult) {
              throw new Error('Failed to encrypt the credential.');
            }

            const dataDescriptor = DataDescriptor.fromJson(
              signdataResult.mmrdescriptor_encrypted.datadescriptors[0]
            );
            const descriptorKey = CompactIAddressObject.fromAddress(
              DATA_DESCRIPTOR_VDXF_KEY.vdxfid
            );
            // The setter for the values array converts using Buffer.from(key, 'hex')
            // so we need to use hex buffer representations.
            newValues.push({[descriptorKey.toBuffer().toString('hex')]: dataDescriptor});
          } else {
            newValues.push({[valueKey.toBuffer().toString('hex')]: valueType});
          }
        }
        vdxfUniValue.values = newValues;
      }
      // Replace the credentials key with a hashed key.
      const credentialKeyResult: GetVdxfIdResult = await api.native.get_vdxf_id(
        coin,
        IDENTITY_CREDENTIAL.vdxfid,
        {
          uint256: ivk,
        }
      );

      if (!credentialKeyResult || !credentialKeyResult.vdxfid) {
        throw new Error('Failed to generate credential key');
      }

      const credentialKey = credentialKeyResult.vdxfid;

      contentmultimap.kvContent.set(CompactIAddressObject.fromAddress(credentialKey), valueArray);
      contentmultimap.kvContent.delete(key);
      break;
    }
  }
}
