/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-27211: every phrase the shared capture modules ask this host to
 * translate has a key in `window.twoGatewayPanelStrings`. A phrase with no key
 * is shown in English on every store, with nothing failing anywhere, which is
 * how four of them went untranslated here.
 *
 * The modules are the base plugin's, so the sweep over their source runs only
 * when TWO_MAGENTO_PLUGIN_DIR names a magento-plugin checkout (CI checks one
 * out). The four phrases that were missing are pinned without it.
 *
 *   TWO_MAGENTO_PLUGIN_DIR=../magento-plugin npm run test:js -- panel-strings-coverage
 */

"use strict";

const fs = require("fs");
const path = require("path");
const H = require("./hyva-harness");

const PLUGIN_DIR = process.env.TWO_MAGENTO_PLUGIN_DIR || "";
const describeReal = PLUGIN_DIR ? describe : describe.skip;

const CHECKOUT_LAYOUT = "view/frontend/layout/hyva_checkout_index_index.xml";

/** The keys of the map the template publishes, rendered as the page renders it. */
function panelStringKeys() {
  delete window.twoGatewayPanelStrings;
  const env = H.installHyvaEnvironment();
  try {
    H.loadTemplate(H.GATEWAY_METHOD_TEMPLATE);
    return Object.keys(window.twoGatewayPanelStrings || {});
  } finally {
    env.restore();
  }
}

/** The base scripts the checkout layout loads, read off the layout itself. */
function layoutModules() {
  const layout = fs.readFileSync(path.join(H.REPO_ROOT, CHECKOUT_LAYOUT), "utf8");
  const files = [];
  const pattern = /<script src="Two_Gateway::js\/model\/([\w.-]+\.js)"\s*\/>/g;
  let match;
  while ((match = pattern.exec(layout)) !== null) files.push(match[1]);
  return files;
}

/**
 * Every literal passed to a `translate(` call in one module, comments
 * stripped first so a phrase quoted in prose is not counted.
 *
 * @param {string} source
 * @returns {string[]}
 */
function translatedLiterals(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const literals = [];
  const pattern = /\btranslate\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*\)/g;
  let match;
  while ((match = pattern.exec(code)) !== null) {
    literals.push(match[2].replace(/\\(['"\\])/g, "$1"));
  }
  return literals;
}

describe("the shared panel phrases this host translates", () => {
  it.each([
    ["Select a different sole trader", "the link out of an adopted sole trader"],
    ["Company Number", "the number label's accessible name"],
    ["1 result is available, use up and down arrow keys to navigate.", "the one-result announcement"],
    ["%1 results are available, use up and down arrow keys to navigate.", "the many-results announcement"],
  ])("has a key for %j (%s)", (phrase) => {
    expect(panelStringKeys()).toContain(phrase);
  });
});

describeReal("every translate() literal in the base modules the checkout loads", () => {
  const modules = layoutModules();
  const keys = panelStringKeys();

  it("finds the modules in the checkout layout", () => {
    expect(modules.length).toBeGreaterThanOrEqual(4);
  });

  it.each(modules)("%s: every literal has a key in twoGatewayPanelStrings", (file) => {
    const source = fs.readFileSync(path.join(PLUGIN_DIR, "view/frontend/web/js/model", file), "utf8");
    const missing = translatedLiterals(source).filter((literal) => keys.indexOf(literal) === -1);
    expect(missing).toEqual([]);
  });

  it("the sweep reads the literals it is meant to (no silent empty match)", () => {
    const all = modules.flatMap((file) =>
      translatedLiterals(fs.readFileSync(path.join(PLUGIN_DIR, "view/frontend/web/js/model", file), "utf8"))
    );
    expect(all).toEqual(expect.arrayContaining(["Company Number", "Select a different sole trader"]));
  });
});
