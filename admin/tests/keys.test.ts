import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createPrivateKey } from "node:crypto";
import { privateKeyBytes } from "../worker/github";
test("GitHub PKCS1 downloads and PKCS8 keys load as the same signing identity", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const expected = privateKey.export({ type: "pkcs8", format: "der" });
  for (const type of ["pkcs1", "pkcs8"] as const) {
    const pem = privateKey.export({ type, format: "pem" }).toString();
    const result = privateKeyBytes(pem);
    assert.deepEqual(Buffer.from(result), expected);
    assert.ok(
      createPrivateKey({
        key: Buffer.from(result),
        type: "pkcs8",
        format: "der",
      }),
    );
  }
  assert.throws(() => privateKeyBytes("not-an-app-key"));
});
