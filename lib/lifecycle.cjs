"use strict";
function validateRegistry(registry) {
  if (!registry || Array.isArray(registry) || typeof registry !== "object")
    throw new Error("Invalid lifecycle registry");
  for (const [key, item] of Object.entries(registry)) {
    if (
      !/^(post:source\/_posts\/.+\.md|home:project:.+)$/.test(key) ||
      !item ||
      !["trash", "purge"].includes(item.mode) ||
      typeof item.url !== "string" ||
      !/^\/(?!\/).+\/$/.test(item.url) ||
      /[?#\\]|\.\./.test(item.url) ||
      !Array.isArray(item.retired) ||
      item.retired.some(
        (p) =>
          typeof p !== "string" ||
          !/\.(png|jpe?g|gif|webp|pdf)$/i.test(p) ||
          p.startsWith("/") ||
          /\.\.|[?#\\]/.test(p),
      )
    )
      throw new Error("Invalid lifecycle entry: " + key);
  }
  return registry;
}
module.exports = { validateRegistry };
