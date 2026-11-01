import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { signOut, localKey } from "../src/api";
const originalFetch = globalThis.fetch;
const originalStorage = globalThis.localStorage;
let data = new Map<string, string>(),
  calls: string[] = [];
beforeEach(() => {
  data = new Map();
  calls = [];
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      removeItem: (key: string) => data.delete(key),
    },
  });
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    assert.equal(options?.method, "POST");
    return new Response(null, { status: 204 });
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: originalStorage,
  });
});
test("logout cannot erase pending or unreadable local drafts", async () => {
  const draft = JSON.stringify({ draft: { body: "unsynced content" } });
  data.set(localKey, draft);
  await assert.rejects(signOut(), /未同步/);
  assert.equal(data.get(localKey), draft);
  data.set(localKey, "invalid-json");
  await assert.rejects(signOut(), /无法读取/);
  assert.equal(data.get(localKey), "invalid-json");
  assert.equal(calls.length, 0);
});
test("logout revokes the session after every local draft has synchronized", async () => {
  data.set(localKey, "{}");
  await signOut();
  assert.deepEqual(calls, ["/api/auth/logout"]);
  assert.equal(data.get(localKey), "{}");
});
test("an edit from another tab during logout remains recoverable", async () => {
  data.set(localKey, "{}");
  const draft = JSON.stringify({
    secondTab: { body: "concurrent unsynced edit" },
  });
  globalThis.fetch = async () => {
    data.set(localKey, draft);
    return new Response(null, { status: 204 });
  };
  await signOut();
  assert.equal(data.get(localKey), draft);
});
