import {
  CompactIAddressObject,
  ContentMultiMap,
  Credential,
  DATA_DESCRIPTOR_VDXF_KEY,
  DATA_TYPE_OBJECT_CREDENTIAL,
  DataDescriptor,
  IDENTITY_CREDENTIAL,
  VdxfUniValue,
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
  contentmultimap: ContentMultiMap,
  ivk: string,
  encryptionAddress: string
): Promise<void> {
  for (const [key, valueArray] of Array.from(contentmultimap.kvContent.entries())) {
    if (key.toIAddress() === IDENTITY_CREDENTIAL.vdxfid) {
      for (let i = 0; i < valueArray.length; i++) {
        const vdxfUniValue = valueArray[i];
        if (!(vdxfUniValue instanceof VdxfUniValue)) continue;
        for (const valueObj of vdxfUniValue.values) {
          // Each valueObj contains exactly one key-value pair.
          const valueKey = Object.keys(valueObj)[0];

          if (valueKey === DATA_TYPE_OBJECT_CREDENTIAL.vdxfid) {
            // Replace the credential with the encrypted data descriptor.
            const vdxfUniType = valueObj[valueKey] as Credential;

            const signdataResult = await api.native.sign_data(coin, {
              address: address,
              vdxfdata: {[valueKey]: vdxfUniType.toJson()},
              encrypttoaddress: encryptionAddress,
            });

            if (!signdataResult) {
              throw new Error('Failed to encrypt the credential.');
            }

            const dataDescriptor = DataDescriptor.fromJson(
              signdataResult.mmrdescriptor_encrypted.datadescriptors[0]
            );
            delete valueObj[valueKey];
            valueObj[DATA_DESCRIPTOR_VDXF_KEY.vdxfid] = dataDescriptor;
          }
        }
      }
      // Replace the credentials key with a hashed key.
      const credentialKeyResult: GetVdxfIdResult | null = await api.native.get_vdxf_id(
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
