"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateRegistry } = require("../../lib/lifecycle.cjs");
test("lifecycle registry accepts explicit post and project withdrawal records", () => {
  const entries = {
    "post:source/_posts/blog/example.md": {
      mode: "trash",
      url: "/2026/01/01/example/",
      retired: ["images/uploads/example.pdf"],
    },
    "home:project:example": {
      mode: "purge",
      url: "/projects/example/",
      retired: [],
    },
  };
  assert.equal(validateRegistry(entries), entries);
});
test("lifecycle exceptions cannot retire scripts, arbitrary routes or traversal paths", () => {
  for (const value of [
    null,
    [],
    { "other:arbitrary": { mode: "purge", url: "/x/", retired: [] } },
    {
      "post:source/_posts/example.md": {
        mode: "purge",
        url: "//evil/",
        retired: [],
      },
    },
    { "home:project:x": { mode: "purge", url: "/../x/", retired: [] } },
    {
      "home:project:x": { mode: "purge", url: "/x/", retired: ["js/main.js"] },
    },
  ])
    assert.throws(() => validateRegistry(value));
});
