// Exercises the validation of a /api/chat request, taken from the Lambda event
// alone. index.mjs cannot be imported outside Lambda (awslambda is a global of
// the runtime), which is why these rules live in their own module.
//
// No AWS, no network, no cost.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ChatError, getClientIp, isWellFormedCaptchaToken, parseRequestBody } from "../agent/request.mjs";

const SESSION = "0b8a1f2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c";
const bodyOf = (fields) => ({ body: JSON.stringify(fields) });

const rejects = (fields, code) =>
  assert.throws(() => parseRequestBody(bodyOf(fields)), (err) => err instanceof ChatError && err.code === code);

describe("le corps de la requête", () => {
  it("rend les trois champs d'une requête valide", () => {
    const parsed = parseRequestBody(bodyOf({ message: "Bonjour", sessionId: SESSION, captchaToken: "tok" }));
    assert.deepEqual(parsed, { message: "Bonjour", sessionId: SESSION, captchaToken: "tok" });
  });

  it("refuse un message qui n'est pas une chaîne", () => {
    rejects({ message: ["a"], sessionId: SESSION }, "INVALID_MESSAGE");
    rejects({ message: { length: 1 }, sessionId: SESSION }, "INVALID_MESSAGE");
  });

  it("accepte 2000 caractères et refuse 2001", () => {
    assert.equal(parseRequestBody(bodyOf({ message: "a".repeat(2000), sessionId: SESSION })).message.length, 2000);
    rejects({ message: "a".repeat(2001), sessionId: SESSION }, "MESSAGE_TOO_LONG");
  });

  it("refuse un sessionId qui n'est pas un UUID v4", () => {
    rejects({ message: "x" }, "INVALID_SESSION");
    rejects({ message: "x", sessionId: "session-1" }, "INVALID_SESSION");
    rejects({ message: "x", sessionId: SESSION.replace("-4f5a-", "-1f5a-") }, "INVALID_SESSION");
  });
});

describe("l'adresse du visiteur", () => {
  it("prend cloudfront-viewer-address et coupe le port au dernier deux-points", () => {
    assert.equal(getClientIp({ headers: { "cloudfront-viewer-address": "1.2.3.4:5678" } }), "1.2.3.4");
    assert.equal(getClientIp({ headers: { "cloudfront-viewer-address": "2001:db8::1:443" } }), "2001:db8::1");
  });

  it("prend la dernière entrée de X-Forwarded-For, jamais celle écrite par le client", () => {
    assert.equal(getClientIp({ headers: { "x-forwarded-for": "6.6.6.6, 1.2.3.4" } }), "1.2.3.4");
  });

  it("retombe sur sourceIp sans en-tête", () => {
    assert.equal(getClientIp({ requestContext: { http: { sourceIp: "9.9.9.9" } } }), "9.9.9.9");
  });
});

describe("la forme du jeton captcha", () => {
  it("accepte une chaîne jusqu'à 2048 caractères", () => {
    assert.equal(isWellFormedCaptchaToken("a".repeat(2048)), true);
  });

  it("refuse une chaîne trop longue ou une autre forme", () => {
    assert.equal(isWellFormedCaptchaToken("a".repeat(2049)), false);
    assert.equal(isWellFormedCaptchaToken({}), false);
  });
});
