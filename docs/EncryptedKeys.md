# Encrypted Keys

Certain vdxfkeys, also known as encrypted keys, are for sensitive data that must be encrypted at rest. The wallet handles the encryption and decryption of the sensitive data for the user.

The encryption and decryption processes are still being developed.

## List of Encrypted Keys

The following keys are used to store sensitive data in encrypted form:

- `vrsc::identity.credential`: Stores credentials (such as usernames and passwords), which can be given to applications for authentication purposes.

## General Notes

1. For encrypting and storing data to be accessed only by a specific identity (e.g., yourself), both the `fromid` and `toid` must match that identity.
2. For the encryption and decryption processes, an identity with a z-address is needed.
3. The decryption process doesn't currently use a vdxfkey for selective searching within the `contentmultimap`, but it should in the future.
4. Currently, the encryption process runs whenever an encrypted key is found at the top level of the `contentmultimap` keys of the Identity Update Request. For a credential, `vrsc::identity.credential` key and the plaintext credential are respectively replaced with a derived key hash (based on `vrsc::identity.credential` and the encryption ivk) and a data descriptor that contains the encrypted credential data. More detail about this replacement can be found below in [Encryption Process with a Credential](#encryption-process-with-a-credential).

## Encryption Process with a Credential

The encryption process follows these steps:

1.  Run `z_getencryptionaddress` with
      - `address`: the identity's z-address
      - `fromid`: the identity's address (e.g., `CredentialTester@`)
      - `toid`: the same identity's address

    The result should contain the z-address that will be used to encrypt the credential and the corresponding incoming viewing key (ivk).
    
    <details><summary>Example:</summary>

    ```bash
    z_getencryptionaddress '{
      "address": "zs1ztll53sh8dst9utln6vl6vn7fv2zdayxhk58rd7casqhemuh5fwymv8q86g9cf670g3wsge573w",
      "fromid": "CredentialTester@",
      "toid": "CredentialTester@"
    }'
    ```
    ```json
    {
      "address": "zs1x49g3lkt93udlnnc8y5k7p5n0vlvqa2r2rsmsj2629hfvwljpn39mltsxy0fktp5ue46wlw3mlc",
      "extendedviewingkey": "zxviews1qde7tnnvqqqqpqy03gsmqjumlyg0ck25hh9etcf7h4l56kunlcjtr36e4pkr32kftw650890j009cdhgm2lc23uyrrq5g7xp5cspjy6lnwf9uk96pv9yruewfrz6k8q0gy9w065cellk3pt37s0ps90rc2zwj4h46f82h35sk23kxduuewc26673fam042zfazxn5r9zwaytcdhc3r50vrutvnnw4zxdalpw2s0w40nxu7qkgh3x3duha872ckhwt9fcl5uy7ne0d3gwknyp2",
      "ivk": "f094f7446c88558005eebfcff532cb448bd0ada959903bc2570b1a5c74e41e07"
    }
    ```
    </details>


2.  Encrypt the credential using `signdata` with
      - `address`: the same identity's address
      - `vdxfdata`: the credential
      - `encrypttoaddress`: the z-address obtained in Step 1

    From the result, get the data descriptor of the encrypted credential, which is in the `mmrdescriptor_encrypted` section of the JSON result.
    
    <details><summary>Example:</summary>

    ```bash
    signdata '{
      "address":"CredentialTester@",
      "vdxfdata": {
        "vrsc::data.type.object.credential":{
          "version": 1,
          "credentialkey": "iHh1FFVvcNb2mcBudD11umfKJXHbBbH6Sj",
          "credential": ["username", "password"],
          "scopes": ["App1@"]
        }
      },
      "encrypttoaddress": "zs1x49g3lkt93udlnnc8y5k7p5n0vlvqa2r2rsmsj2629hfvwljpn39mltsxy0fktp5ue46wlw3mlc"
    }'
    ```
    ```json
    {
      "version": 1,
      "flags": 5,
      "objectdata": "fb9a69e5019a6a790b94cd7c5c1cef65126029e8709c3efcbd302fff69bf3488a4fbde512fc4117cc989dd8d3f98d3650e60e90eb02add89fb3c887d225eeee62723b4f71d192cb0ebe17bcc0680501b86201a4448fd562368d62efac7a7778e943fe93841acf091f02210b24cf988449241782962b65731e7939a9adaa8fd870100dd598ea6a4c22bbd620e07b996e53e521f38849210f9f2d916599346fe1676484e461a61ae9c7437e111",
      "epk": "27d8a2e582b6f30bac693154d6d18a4ee333fc93ae8361813b4c6c7c6ed1f90b"
    }
    ```
    </details>


3.  Hash the vdxfkey corresponding to `vrsc::identity.credential` with the ivk using `getvdxfid` with
      - `vrsc::identity.credential`
      - `uint256`: the ivk

    Get the `vdxfid` in the result for the next step.

    <details><summary>Example:</summary>

    ```bash
    getvdxfid vrsc::identity.credential '{"uint256":"f094f7446c88558005eebfcff532cb448bd0ada959903bc2570b1a5c74e41e07"}'
    ```
    ```json
    {
      "vdxfid": "i4zYNxkyAsMKuL5MFV9cy5aqxCbhTnS3da",
      "indexid": "x9peqmC42BZzXVxP7AomwU7NyrciGcZi1T",
      "hash160result": "01dc9f8b9389d5569b6fa505185fd37e0265a510",
      "qualifiedname": {
        "namespace": "i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV",
        "name": "vrsc::identity.credential"
      },
      "bounddata": {
        "uint256": "f094f7446c88558005eebfcff532cb448bd0ada959903bc2570b1a5c74e41e07"
      }
    }
    ```


4.  Add the encrypted credential to the contentmultimap using `updateidentity` with
      - `name`: the identity's address
      - `contentmultimap`: the hashed vdxfkey from Step 3 with the data descriptor of the encrypted credential

    <details><summary>Example:</summary>

    ```bash
    updateidentity '{     
      "name": "CredentialTester@",
      "contentmultimap": {
        "i4zYNxkyAsMKuL5MFV9cy5aqxCbhTnS3da": [
          {
            "vrsc::data.type.object.datadescriptor": {
              "version": 1,
              "flags": 5,
              "objectdata": "fb9a69e5019a6a790b94cd7c5c1cef65126029e8709c3efcbd302fff69bf3488a4fbde512fc4117cc989dd8d3f98d3650e60e90eb02add89fb3c887d225eeee62723b4f71d192cb0ebe17bcc0680501b86201a4448fd562368d62efac7a7778e943fe93841acf091f02210b24cf988449241782962b65731e7939a9adaa8fd870100dd598ea6a4c22bbd620e07b996e53e521f38849210f9f2d916599346fe1676484e461a61ae9c7437e111",
              "epk": "27d8a2e582b6f30bac693154d6d18a4ee333fc93ae8361813b4c6c7c6ed1f90b"
            }
          }
        ]
      }
    }'
    ```
    </details>


## Decryption Process with a Credential

The decryption process follows these steps:

1.  Run `z_getencryptionaddress` with
      - `address`: the identity's z-address
      - `fromid`: the identity's address (e.g., `CredentialTester@`)
      - `toid`: the same identity's address

    This is the same as Step 1 from the [*Encryption Process*](#encryption-process).

    The result should contain an ivk and extended viewing key (evk), which will be used to find and decrypt the credential.
    
    <details><summary>Example:</summary>

    ```bash
    z_getencryptionaddress '{
      "address": "zs1ztll53sh8dst9utln6vl6vn7fv2zdayxhk58rd7casqhemuh5fwymv8q86g9cf670g3wsge573w",
      "fromid": "CredentialTester@",
      "toid": "CredentialTester@"
    }'
    ```
    ```json
    {
      "address": "zs1x49g3lkt93udlnnc8y5k7p5n0vlvqa2r2rsmsj2629hfvwljpn39mltsxy0fktp5ue46wlw3mlc",
      "extendedviewingkey": "zxviews1qde7tnnvqqqqpqy03gsmqjumlyg0ck25hh9etcf7h4l56kunlcjtr36e4pkr32kftw650890j009cdhgm2lc23uyrrq5g7xp5cspjy6lnwf9uk96pv9yruewfrz6k8q0gy9w065cellk3pt37s0ps90rc2zwj4h46f82h35sk23kxduuewc26673fam042zfazxn5r9zwaytcdhc3r50vrutvnnw4zxdalpw2s0w40nxu7qkgh3x3duha872ckhwt9fcl5uy7ne0d3gwknyp2",
      "ivk": "f094f7446c88558005eebfcff532cb448bd0ada959903bc2570b1a5c74e41e07"
    }
    ```
    </details>


2.  Hash the vdxfkey corresponding to `vrsc::identity.credential` with the ivk using `getvdxfid` with
      - `vrsc::identity.credential`
      - `uint256`: the ivk

    This is identical as Step 3 from the [*Encryption Process*](#encryption-process).

    Get the `vdxfid` in the result for Step 4.

    <details><summary>Example:</summary>

    ```bash
    getvdxfid vrsc::identity.credential '{"uint256":"f094f7446c88558005eebfcff532cb448bd0ada959903bc2570b1a5c74e41e07"}'
    ```
    ```json
    {
      "vdxfid": "i4zYNxkyAsMKuL5MFV9cy5aqxCbhTnS3da",
      "indexid": "x9peqmC42BZzXVxP7AomwU7NyrciGcZi1T",
      "hash160result": "01dc9f8b9389d5569b6fa505185fd37e0265a510",
      "qualifiedname": {
        "namespace": "i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV",
        "name": "vrsc::identity.credential"
      },
      "bounddata": {
        "uint256": "f094f7446c88558005eebfcff532cb448bd0ada959903bc2570b1a5c74e41e07"
      }
    }
    ```


3.  Get the `contentmultimap` of the identity using `getidentitycontent` with
      - the identity's address

    The `contentmultimap` is within the `identity` part of the JSON result.

    <details><summary>Example:</summary>

    ```bash
    getidentitycontent CredentialTester@
    ```
    ```json
    "contentmultimap": {
      "i4zYNxkyAsMKuL5MFV9cy5aqxCbhTnS3da": [
        {
          "i4GC1YGEVD21afWudGoFJVdnfjJ5XWnCQv": {
            "version": 1,
            "flags": 5,
            "objectdata": "fb9a69e5019a6a790b94cd7c5c1cef65126029e8709c3efcbd302fff69bf3488a4fbde512fc4117cc989dd8d3f98d3650e60e90eb02add89fb3c887d225eeee62723b4f71d192cb0ebe17bcc0680501b86201a4448fd562368d62efac7a7778e943fe93841acf091f02210b24cf988449241782962b65731e7939a9adaa8fd870100dd598ea6a4c22bbd620e07b996e53e521f38849210f9f2d916599346fe1676484e461a61ae9c7437e111",
            "epk": "27d8a2e582b6f30bac693154d6d18a4ee333fc93ae8361813b4c6c7c6ed1f90b"
          }
        }
      ]
    }
    ```
    </details>


4.  Using the hashed vdxfkey created in Step 2, find the data descriptor of the encrypted credential, and decrypt it using `decryptdata` with
      - `datadescriptor`: the data descriptor of the encrypted credential
      - `evk`: the evk obtained in Step 1

    <details><summary>Example:</summary>

    ```bash
    decryptdata '{
      "datadescriptor": {
          "version": 1,
          "flags": 5,
          "objectdata": "fb9a69e5019a6a790b94cd7c5c1cef65126029e8709c3efcbd302fff69bf3488a4fbde512fc4117cc989dd8d3f98d3650e60e90eb02add89fb3c887d225eeee62723b4f71d192cb0ebe17bcc0680501b86201a4448fd562368d62efac7a7778e943fe93841acf091f02210b24cf988449241782962b65731e7939a9adaa8fd870100dd598ea6a4c22bbd620e07b996e53e521f38849210f9f2d916599346fe1676484e461a61ae9c7437e111",
          "epk": "27d8a2e582b6f30bac693154d6d18a4ee333fc93ae8361813b4c6c7c6ed1f90b"
        },
      "evk":"zxviews1qde7tnnvqqqqpqy03gsmqjumlyg0ck25hh9etcf7h4l56kunlcjtr36e4pkr32kftw650890j009cdhgm2lc23uyrrq5g7xp5cspjy6lnwf9uk96pv9yruewfrz6k8q0gy9w065cellk3pt37s0ps90rc2zwj4h46f82h35sk23kxduuewc26673fam042zfazxn5r9zwaytcdhc3r50vrutvnnw4zxdalpw2s0w40nxu7qkgh3x3duha872ckhwt9fcl5uy7ne0d3gwknyp2"
    }'
    ```
    ```json
    [
      {
        "iDTG49YLqmkHMYRyuQBYgEyTByQwAzqGd6": {
          "version": 1,
          "flags": 0,
          "credentialkey": "iHh1FFVvcNb2mcBudD11umfKJXHbBbH6Sj",
          "credential": [
            "cjkdfasjak@tlmail.com",
            "!@23ji2390uodsf"
          ],
          "scopes": [
            "App1@"
          ]
        }
      }
    ]
    ```
    </details>
