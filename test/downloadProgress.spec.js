const assert = require('assert');
const fs = require('fs-extra');
const http = require('http');
const os = require('os');
const path = require('path');
const { describe, it } = require('node:test');

const listen = (server) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    server.removeListener('error', reject);
    resolve(server.address().port);
  });
});

const close = (server) => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});

const waitForPromises = () => new Promise((resolve) => setImmediate(resolve));

const emptyCheckList = {
  outputKey: false,
  outputKeySize: false,
  spendKey: false,
  spendKeySize: false,
  groth16Key: false,
  groth16KeySize: false,
};

const completeCheckList = {
  outputKey: true,
  outputKeySize: true,
  spendKey: true,
  spendKeySize: true,
  groth16Key: true,
  groth16KeySize: true,
};

const createZcashParamsHarness = (downloadFile, checkListForCall) => {
  let downloadHandler;
  let checkCount = 0;
  const emissions = [];
  const api = {
    paths: { zcashParamsDir: '/unused/zcash-params' },
    setPost(route, handler) {
      if (route === '/zcparamsdl') downloadHandler = handler;
    },
    downloadFile,
    io: {
      emit(event, payload) {
        emissions.push({ event, payload });
      },
    },
    log() {},
  };

  require('../routes/api/downloadZcparams')(api);
  api.zcashParamsExist = () => {
    checkCount += 1;
    if (checkListForCall) return checkListForCall(checkCount);
    return checkCount === 1 ? emptyCheckList : completeCheckList;
  };

  return { api, downloadHandler, emissions };
};

describe('Zcash parameter download progress', () => {
  it('reports the response Content-Length and resolves after the file is flushed', async () => {
    const payload = Buffer.from('zcash-parameter-download');
    const server = http.createServer((request, response) => {
      response.writeHead(200, { 'Content-Length': String(payload.length) });
      response.write(payload.subarray(0, 7));
      setImmediate(() => response.end(payload.subarray(7)));
    });
    const port = await listen(server);
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'verus-download-progress-'));
    const outputFile = path.join(temporaryRoot, 'params.bin');
    const progress = [];
    const api = {};
    require('../routes/api/downloadUtil')(api);

    try {
      await api.downloadFile({
        remoteFile: `http://127.0.0.1:${port}/params`,
        localFile: outputFile,
        onProgress(received, total) {
          progress.push({ received, total });
        },
      });

      assert.ok(progress.length >= 1);
      assert.ok(progress.every(({ received, total }) =>
        Number.isFinite(received) && total === payload.length));
      assert.strictEqual(progress[progress.length - 1].received, payload.length);
      assert.deepStrictEqual(await fs.readFile(outputFile), payload);
    } finally {
      await Promise.all([close(server), fs.remove(temporaryRoot)]);
    }
  });

  it('uses the expected file size when the server omits Content-Length', async () => {
    const payload = Buffer.from('chunked-zcash-parameter-download');
    const server = http.createServer((request, response) => {
      response.write(payload.subarray(0, 8));
      setImmediate(() => response.end(payload.subarray(8)));
    });
    const port = await listen(server);
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'verus-download-fallback-'));
    const outputFile = path.join(temporaryRoot, 'params.bin');
    const totals = [];
    const api = {};
    require('../routes/api/downloadUtil')(api);

    try {
      await api.downloadFile({
        remoteFile: `http://127.0.0.1:${port}/params`,
        localFile: outputFile,
        expectedBytes: payload.length,
        onProgress(received, total) {
          totals.push(total);
        },
      });

      assert.ok(totals.length >= 1);
      assert.ok(totals.every((total) => total === payload.length));
      assert.deepStrictEqual(await fs.readFile(outputFile), payload);
    } finally {
      await Promise.all([close(server), fs.remove(temporaryRoot)]);
    }
  });

  it('rejects when the destination file cannot be written', async () => {
    const server = http.createServer((request, response) => {
      response.end('download-data');
    });
    const port = await listen(server);
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'verus-download-error-'));
    const api = {};
    require('../routes/api/downloadUtil')(api);

    try {
      await assert.rejects(
        api.downloadFile({
          remoteFile: `http://127.0.0.1:${port}/params`,
          localFile: path.join(temporaryRoot, 'missing-directory', 'params.bin'),
        }),
        /ENOENT/
      );
    } finally {
      await Promise.all([close(server), fs.remove(temporaryRoot)]);
    }
  });

  it('emits finite integer progress once per changed percentage', async () => {
    const { downloadHandler, emissions } = createZcashParamsHarness((configuration) => {
      assert.ok(Number.isFinite(configuration.expectedBytes));
      configuration.onProgress(1, 100);
      configuration.onProgress(1.9, 100);
      configuration.onProgress(50, 100);
      return Promise.resolve();
    });
    let response;

    downloadHandler(
      { body: { dloption: 'verus.io' } },
      { send(body) { response = JSON.parse(body); } },
      () => {}
    );
    await waitForPromises();

    assert.strictEqual(response.msg, 'success');
    const progress = emissions
      .map(({ payload }) => payload.msg)
      .filter((message) => message.status === 'progress');
    assert.strictEqual(progress.length, 6);
    assert.ok(progress.every((message) =>
      Number.isInteger(message.progress) &&
      Number.isFinite(message.progress) &&
      message.progress > 0 &&
      message.progress < 100));
    assert.strictEqual(
      emissions.filter(({ payload }) =>
        payload.msg.status === 'done' && payload.msg.file === 'all').length,
      1
    );
  });

  it('emits a terminal error and never reports all files done after a rejection', async () => {
    const { downloadHandler, emissions } = createZcashParamsHarness((configuration) => {
      return configuration.localFile.includes('sapling-spend')
        ? Promise.reject(new Error('download interrupted'))
        : Promise.resolve();
    });

    downloadHandler(
      { body: { dloption: 'verus.io' } },
      { send() {} },
      () => {}
    );
    await waitForPromises();

    assert.ok(emissions.some(({ payload }) =>
      payload.msg.status === 'error' &&
      payload.msg.file === 'spend' &&
      payload.msg.message === 'download interrupted'));
    assert.strictEqual(
      emissions.some(({ payload }) =>
        payload.msg.status === 'done' && payload.msg.file === 'all'),
      false
    );
  });

  it('rejects a completed file whose size does not match', async () => {
    const mismatchedSpendCheckList = {
      ...completeCheckList,
      spendKeySize: false,
    };
    const { downloadHandler, emissions } = createZcashParamsHarness(
      () => Promise.resolve(),
      (checkCount) => checkCount === 1 ? emptyCheckList : mismatchedSpendCheckList
    );

    downloadHandler(
      { body: { dloption: 'verus.io' } },
      { send() {} },
      () => {}
    );
    await waitForPromises();

    assert.ok(emissions.some(({ payload }) =>
      payload.msg.status === 'error' &&
      payload.msg.file === 'spend' &&
      payload.msg.message === 'size mismatch'));
    assert.strictEqual(
      emissions.some(({ payload }) =>
        payload.msg.status === 'done' && payload.msg.file === 'all'),
      false
    );
  });
});
