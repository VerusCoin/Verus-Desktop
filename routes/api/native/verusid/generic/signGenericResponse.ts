import {GenericResponse} from 'verus-typescript-primitives';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default (api: any) => {
  api.native.verusid.generic.sign_response = async (coin: string, response: GenericResponse) => {
    const signdataResult = await api.native.sign_data(coin, {
      address: response.signature.identityID.toIAddress(),
      datahash: response.getRawDataSha256().toString('hex'),
    });

    response.signature.signatureAsVch = Buffer.from(signdataResult.signature, 'base64');

    return response;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api.setPost('/native/verusid/generic/sign_generic_response', async (req: any, res: any) => {
    const {chainTicker, response} = req.body;

    // The response comes in as a hex string of the buffer representation.
    const genericResponse = new GenericResponse();
    genericResponse.fromBuffer(Buffer.from(response, 'hex'));

    try {
      const signedResponse = await api.native.verusid.generic.sign_response(
        chainTicker,
        genericResponse
      );
      res.send(
        JSON.stringify({
          msg: 'success',
          result: signedResponse.toBuffer().toString('hex'),
        })
      );
    } catch (e) {
      res.send(
        JSON.stringify({
          msg: 'error',
          result: e.message,
        })
      );
    }
  });

  return api;
};
