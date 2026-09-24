// Exercises the Turnstile verification decision against a mocked siteverify
// call. The SSM secret lookup is bypassed via the overrides parameter, so
// none of this touches AWS.
//
// No Bedrock, no network, no cost.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isCaptchaVerified } from "../agent/captcha.mjs";

const SECRET = "test-secret";

function mockFetch(t, impl) {
  t.mock.method(globalThis, "fetch", impl);
}

describe("les réponses explicites de siteverify", () => {
  it("accepte un token valide pour la bonne action et le bon hostname", async (t) => {
    mockFetch(t, async () =>
      new Response(JSON.stringify({ success: true, action: "chat_first_message", hostname: "rr-djuikoo.com" }), {
        status: 200,
      })
    );

    assert.equal(await isCaptchaVerified("tok", "1.2.3.4", { secret: SECRET }), true);
  });

  it("rejette success: false", async (t) => {
    mockFetch(t, async () =>
      new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), { status: 200 })
    );

    assert.equal(await isCaptchaVerified("tok", "1.2.3.4", { secret: SECRET }), false);
  });

  it("rejette une action différente de celle attendue", async (t) => {
    mockFetch(t, async () =>
      new Response(JSON.stringify({ success: true, action: "autre_surface", hostname: "rr-djuikoo.com" }), {
        status: 200,
      })
    );

    assert.equal(await isCaptchaVerified("tok", "1.2.3.4", { secret: SECRET }), false);
  });

  it("rejette un hostname hors de l'allowlist", async (t) => {
    mockFetch(t, async () =>
      new Response(JSON.stringify({ success: true, action: "chat_first_message", hostname: "evil.example" }), {
        status: 200,
      })
    );

    assert.equal(await isCaptchaVerified("tok", "1.2.3.4", { secret: SECRET }), false);
  });
});

describe("les pannes du côté de Cloudflare (fail-open)", () => {
  it("laisse passer sur une erreur réseau", async (t) => {
    mockFetch(t, async () => {
      throw new Error("network down");
    });

    assert.equal(await isCaptchaVerified("tok", "1.2.3.4", { secret: SECRET }), true);
  });

  it("laisse passer sur un statut HTTP non-2xx de siteverify", async (t) => {
    mockFetch(t, async () => new Response("", { status: 503 }));

    assert.equal(await isCaptchaVerified("tok", "1.2.3.4", { secret: SECRET }), true);
  });
});
