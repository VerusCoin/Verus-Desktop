const assert = require("assert");
const http = require("http");
const { describe, it } = require("node:test");
const axios = require("axios");
const systeminformation = require("systeminformation");
const { DOMParser } = require("@xmldom/xmldom");

const listen = (server) => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    server.removeListener("error", reject);
    resolve(server.address().port);
  });
});

const close = (server) => new Promise((resolve, reject) => {
  server.close((error) => {
    if (error) reject(error);
    else resolve();
  });
});

const readRequestBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
};

describe("security dependency compatibility", () => {
  it("preserves the Axios APIs used by RPC, downloads, and callbacks", async () => {
    let redirectedAuthorization;
    const redirectTarget = http.createServer((request, response) => {
      redirectedAuthorization = request.headers.authorization;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ redirected: true }));
    });
    const targetPort = await listen(redirectTarget);

    const applicationServer = http.createServer(async (request, response) => {
      if (request.url === "/redirect") {
        response.writeHead(302, { location: `http://127.0.0.1:${targetPort}/target` });
        response.end();
        return;
      }

      if (request.url === "/stream") {
        response.end("download-data");
        return;
      }

      const body = await readRequestBody(request);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        authorization: request.headers.authorization,
        body: body.length === 0 ? null : JSON.parse(body),
      }));
    });
    const applicationPort = await listen(applicationServer);
    const baseUrl = `http://127.0.0.1:${applicationPort}`;

    try {
      assert.strictEqual(axios.VERSION, "1.18.0");

      const postResponse = await axios.post(
        `${baseUrl}/rpc`,
        { method: "getinfo" },
        {
          auth: { username: "rpc-user", password: "rpc-password" },
          proxy: false,
        }
      );
      assert.deepStrictEqual(postResponse.data, {
        authorization: `Basic ${Buffer.from("rpc-user:rpc-password").toString("base64")}`,
        body: { method: "getinfo" },
      });

      const streamResponse = await axios.get(`${baseUrl}/stream`, {
        proxy: false,
        responseType: "stream",
      });
      const chunks = [];
      for await (const chunk of streamResponse.data) chunks.push(chunk);
      assert.strictEqual(Buffer.concat(chunks).toString("utf8"), "download-data");

      const redirectResponse = await axios.get(`${baseUrl}/redirect`, {
        headers: { authorization: "Bearer must-not-leak" },
        proxy: false,
      });
      assert.deepStrictEqual(redirectResponse.data, { redirected: true });
      assert.strictEqual(redirectedAuthorization, undefined);
    } finally {
      await Promise.all([close(applicationServer), close(redirectTarget)]);
    }
  });

  it("preserves the system information calls used by diagnostics", async () => {
    assert.strictEqual(systeminformation.version(), "5.31.7");

    const staticData = await systeminformation.getStaticData();
    assert.ok(staticData && typeof staticData === "object");
    assert.ok(staticData.system && typeof staticData.system === "object");
    assert.ok(staticData.os && typeof staticData.os === "object");

    const time = systeminformation.time();
    assert.ok(time && Number.isFinite(time.current));
  });

  it("preserves the ECB exchange-rate XML traversal", () => {
    const parser = new DOMParser();
    const document = parser.parseFromString(
      "<Envelope><Cube><Cube currency=\"USD\" rate=\"1.25\"/><Cube currency=\"EUR\" rate=\"1\"/></Cube></Envelope>",
      "text/xml"
    );
    const cubes = document.getElementsByTagName("Cube");
    const exchangeRates = {};

    for (let index = 0; index < cubes.length; index += 1) {
      const currency = cubes[index].getAttribute("currency");
      const rate = cubes[index].getAttribute("rate");
      if (currency && rate) exchangeRates[currency] = Number(rate);
    }

    assert.deepStrictEqual(exchangeRates, { USD: 1.25, EUR: 1 });
  });
});
