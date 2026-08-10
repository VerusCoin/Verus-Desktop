"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
  buildContentSecurityPolicy,
  createContentSecurityPolicyMiddleware,
} = require("../routes/security/csp");

describe("renderer Content Security Policy", function () {
  it("allows only packaged code and the exact loopback backend", function () {
    const policy = buildContentSecurityPolicy(17775);
    assert.match(policy, /default-src 'none'/);
    assert.match(policy, /script-src 'self'/);
    assert.match(policy, /connect-src 'self' http:\/\/127\.0\.0\.1:17775 ws:\/\/127\.0\.0\.1:17775/);
    assert.match(policy, /object-src 'none'/);
    assert.match(policy, /frame-src 'none'/);
    assert.doesNotMatch(policy, /unsafe-eval/);
    assert.doesNotMatch(policy, /script-src[^;]*unsafe-inline/);
    assert.doesNotMatch(policy, /https?:\/\/localhost/);
    assert.throws(() => buildContentSecurityPolicy(0), /valid renderer API port/);
  });

  it("sets the HTTP header only when production enforcement is enabled", function () {
    for (const enabled of [true, false]) {
      const headers = new Map();
      let nextCalls = 0;
      createContentSecurityPolicyMiddleware(17775, enabled)(
        {},
        { setHeader(name, value) { headers.set(name, value); } },
        () => { nextCalls += 1; }
      );
      assert.strictEqual(nextCalls, 1);
      assert.strictEqual(headers.has("Content-Security-Policy"), enabled);
    }
  });

});
