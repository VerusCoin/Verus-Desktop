# Credentials

Credentials contain sensitive information, so they must be encrypted at rest. The wallet handles the encryption and decryption of credentials for the user.

The encryption and decryption processes are works in progress.

## Notes

1. For encrypting and storing data to be accessed only by a specific identity (e.g., yourself), the `fromid` and `toid` both must match that identity.
2. For the encryption and decryption processes, an identity with a z-address is needed. 

## Encryption Process

The steps for the encryption process are as follows.

1.  Run `z_getencryptionaddress` with
      - `address`: the identity's z-address
      - `fromid`: the identity's address (e.g., `CredentialTester@`)
      - `toid`: the same identity's address

    The result should contain the z-address that will be used to encrypt the credential and its corresponding extended viewing key.
    
    <details><summary>Example:</summary>

    ```json
    z_getencryptionaddress '{
      "address": "zs1ztll53sh8dst9utln6vl6vn7fv2zdayxhk58rd7casqhemuh5fwymv8q86g9cf670g3wsge573w",
      "fromid": "CredentialTester@",
      "toid": "CredentialTester@"
    }'
    ```
    ```json
    {
      "address": "zs1x49g3lkt93udlnnc8y5k7p5n0vlvqa2r2rsmsj2629hfvwljpn39mltsxy0fktp5ue46wlw3mlc",
      "extendedviewingkey": "zxviews1qde7tnnvqqqqpqy03gsmqjumlyg0ck25hh9etcf7h4l56kunlcjtr36e4pkr32kftw650890j009cdhgm2lc23uyrrq5g7xp5cspjy6lnwf9uk96pv9yruewfrz6k8q0gy9w065cellk3pt37s0ps90rc2zwj4h46f82h35sk23kxduuewc26673fam042zfazxn5r9zwaytcdhc3r50vrutvnnw4zxdalpw2s0w40nxu7qkgh3x3duha872ckhwt9fcl5uy7ne0d3gwknyp2"
    }
    ```
    </details>


2.  Encrypt the credential using `signdata` with
      - `address`: the same identity's address
      - `vdxfdata`: the credential
      - `encrypttoaddress`: the z-address obtained in Step 1

    From the result, get the data descriptor of the encrypted credential, which is in the `mmrdescriptor_encrypted` section of the JSON result.
    
    <details><summary>Example:</summary>

    ```json
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


3.  Hash `vrsc::identity.credentials` with the extended viewing key using `getvdxfid` with
      - `vrsc::identity.credentials`
      - `vdxfkey`: the extended viewing key

    Get the `vdxfid` in the result for the next step.

    <details><summary>Example:</summary>

    ```json
    getvdxfid vrsc::identity.credentials '{"vdxfkey":"zxviews1qde7tnnvqqqqpqy03gsmqjumlyg0ck25hh9etcf7h4l56kunlcjtr36e4pkr32kftw650890j009cdhgm2lc23uyrrq5g7xp5cspjy6lnwf9uk96pv9yruewfrz6k8q0gy9w065cellk3pt37s0ps90rc2zwj4h46f82h35sk23kxduuewc26673fam042zfazxn5r9zwaytcdhc3r50vrutvnnw4zxdalpw2s0w40nxu7qkgh3x3duha872ckhwt9fcl5uy7ne0d3gwknyp2"}'
    ```
    ```json
    {
      "vdxfid": "iAkLK2ruEUhZxH9Wy45W8XKGfbeUUg5Bp8",
      "indexid": "xFaSmqHz5nvEaT2Ypjjf6uqohFfVGyMb1c",
      "hash160result": "86a4deebbaecab2da5c8547b2fda278c8d40c64f",
      "qualifiedname": {
        "namespace": "i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV",
        "name": "vrsc::identity.credentials"
      },
      "bounddata": {
        "vdxfkey": "iMArFRJ3bZPg65ttXJdxGub4VbPWYRqBwW"
      }
    }
    ```


4.  Add the encrypted credential to the contentmultimap using `updateidentity` with
      - `name`: the identity's address
      - `contentmultimap`: the hashed `vrsc::identity.credentials` key with the data descriptor of the encrypted credential

    <details><summary>Example:</summary>

    ```json
    updateidentity '{     
      "name": "CredentialTester@",
      "contentmultimap": {
        "iAkLK2ruEUhZxH9Wy45W8XKGfbeUUg5Bp8": [
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


## Decryption Process

The steps for the decryption process are as follows.

1.  Run `z_getencryptionaddress` with
      - `address`: the identity's z-address
      - `fromid`: the identity's address (e.g., `CredentialTester@`)
      - `toid`: the same identity's address

    This is the same as Step 1 from the [*Encryption Process*](#encryption-process).

    The result should contain a z-address and its corresponding extended viewing key, which will be used to find and decrypt the credential.
    
    <details><summary>Example:</summary>

    ```json
    z_getencryptionaddress '{
      "address": "zs1ztll53sh8dst9utln6vl6vn7fv2zdayxhk58rd7casqhemuh5fwymv8q86g9cf670g3wsge573w",
      "fromid": "CredentialTester@",
      "toid": "CredentialTester@"
    }'
    ```
    ```json
    {
      "address": "zs1x49g3lkt93udlnnc8y5k7p5n0vlvqa2r2rsmsj2629hfvwljpn39mltsxy0fktp5ue46wlw3mlc",
      "extendedviewingkey": "zxviews1qde7tnnvqqqqpqy03gsmqjumlyg0ck25hh9etcf7h4l56kunlcjtr36e4pkr32kftw650890j009cdhgm2lc23uyrrq5g7xp5cspjy6lnwf9uk96pv9yruewfrz6k8q0gy9w065cellk3pt37s0ps90rc2zwj4h46f82h35sk23kxduuewc26673fam042zfazxn5r9zwaytcdhc3r50vrutvnnw4zxdalpw2s0w40nxu7qkgh3x3duha872ckhwt9fcl5uy7ne0d3gwknyp2"
    }
    ```
    </details>


2.  Hash `vrsc::identity.credentials` with the extended viewing key using `getvdxfid` with
      - `vrsc::identity.credentials`
      - `vdxfkey`: the extended viewing key

    This is the same as Step 3 from the [*Encryption Process*](#encryption-process).

    Get the `vdxfid` in the result for Step 4.

    <details><summary>Example:</summary>

    ```json
    getvdxfid vrsc::identity.credentials '{"vdxfkey":"zxviews1qde7tnnvqqqqpqy03gsmqjumlyg0ck25hh9etcf7h4l56kunlcjtr36e4pkr32kftw650890j009cdhgm2lc23uyrrq5g7xp5cspjy6lnwf9uk96pv9yruewfrz6k8q0gy9w065cellk3pt37s0ps90rc2zwj4h46f82h35sk23kxduuewc26673fam042zfazxn5r9zwaytcdhc3r50vrutvnnw4zxdalpw2s0w40nxu7qkgh3x3duha872ckhwt9fcl5uy7ne0d3gwknyp2"}'
    ```
    ```json
    {
      "vdxfid": "iAkLK2ruEUhZxH9Wy45W8XKGfbeUUg5Bp8",
      "indexid": "xFaSmqHz5nvEaT2Ypjjf6uqohFfVGyMb1c",
      "hash160result": "86a4deebbaecab2da5c8547b2fda278c8d40c64f",
      "qualifiedname": {
        "namespace": "i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV",
        "name": "vrsc::identity.credentials"
      },
      "bounddata": {
        "vdxfkey": "iMArFRJ3bZPg65ttXJdxGub4VbPWYRqBwW"
      }
    }
    ```


3.  Get the `contentmultimap` of the identity using `getidentitycontent` with
      - the identity's address

    This doesn't currently use a `vdxfkey` for selective searching within the `contentmultimap`, but it should in the future.

    The `contentmultimap` is within the `identity` part of the JSON result.

    <details><summary>Example:</summary>

    ```json
    getidentitycontent CredentialTester@
    ```
    ```json
    "contentmultimap": {
      "iAkLK2ruEUhZxH9Wy45W8XKGfbeUUg5Bp8": [
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


4.  Using the hashed key created in Step 2, find the data descriptor of the encrypted credential, and decrypt it using `decryptdata` with
      - `datadescriptor`: the data descriptor of the encrypted credential
      - `evk`: the extended viewing key obtained in Step 1

    <details><summary>Example:</summary>

    ```json
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