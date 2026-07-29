/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * Jest config for the module's browser JS.
 *
 * Mirrors magento-plugin's Test/Js/jest.config.js and prestashop-plugin's
 * tests/js/jest.config.js: the config sits next to the tests, `rootDir` points
 * back at the repo root so a test can read the shipped template files by their
 * real repo-relative paths, and jsdom supplies the document the Alpine
 * components need.
 */

module.exports = {
  rootDir: "../..",
  testMatch: ["<rootDir>/Test/Js/**/*.test.js"],
  testEnvironment: "jsdom",
  // The suite restores its own stubs by hand; these are the net for the next
  // test that forgets to, since a leaked spy on Date.now, console.error or
  // window.fetch fails somewhere other than where it was created.
  restoreMocks: true,
  resetMocks: true,
};
