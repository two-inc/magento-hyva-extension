/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-26775: this checkout's host over the REAL shared capture modules rather
 * than the harness stubs, so a change to their contract shows up here.
 *
 * The modules are not in this repo, so the suite runs only when
 * TWO_MAGENTO_PLUGIN_DIR names a magento-plugin checkout; without it every case
 * is skipped, and says so in its name.
 *
 *   TWO_MAGENTO_PLUGIN_DIR=../magento-plugin npm run test:js -- shared-modules-smoke
 */

"use strict";

const H = require("./hyva-harness");

const PLUGIN_DIR = process.env.TWO_MAGENTO_PLUGIN_DIR || "";
const describeReal = PLUGIN_DIR ? describe : describe.skip;
const ADDRESS_COMPONENT = "twoGatewayHyvaCompanySearchField";

/** One invoice address panel, its company control four levels below the form. */
const MARKUP = [
  '<form id="billing-form">',
  '  <select id="billing-country_id" name="billing[country_id]">',
  '    <option value="GB" selected>GB</option>',
  "  </select>",
  "  <div><div><div>",
  '  <div id="billing-company-root" class="two-company-search"' +
    ' data-two-capture-host="address" data-two-capture-role="">',
  '    <input type="text" id="billing-company-field" data-two-capture-field value="" />',
  "  </div>",
  "  </div></div></div>",
  "</form>",
  '<div id="page-text">page text</div>',
].join("\n");

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The store's relays a mount and a Sole trader click call, and nothing else. */
const ROUTES = [
  ["supported-company-types", ["SOLE_TRADER", "LIMITED_COMPANY"]],
  ["supported-countries", [JSON.stringify({ ok: true, status: 200, body: { supported_countries: ["gb", "GB"] } })]],
  ["get-tokens", [{ delegation_token: "dt", autofill_token: "at" }]],
];

function routedFetch(url) {
  const route = ROUTES.find((entry) => String(url).includes(entry[0]));
  const body = route ? route[1] : null;
  return Promise.resolve({
    ok: Boolean(body),
    status: body ? 200 : 404,
    json: () => Promise.resolve(body || {}),
  });
}

describeReal(`the real shared modules under this host${PLUGIN_DIR ? "" : " (set TWO_MAGENTO_PLUGIN_DIR)"}`, () => {
  let env;
  let popups;
  let originalFetch;
  let surface;

  function field() {
    return document.getElementById("billing-company-field");
  }

  /** Open the popover the buyer's way and hand back one of its chips. */
  function chip(mode) {
    if (!document.querySelector('[data-two-chip="' + mode + '"]')) {
      field().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    }
    return document.querySelector('[data-two-chip="' + mode + '"]');
  }

  function press(target, init) {
    target.dispatchEvent(
      new MouseEvent("mousedown", Object.assign({ bubbles: true, cancelable: true, button: 0 }, init)),
    );
  }

  async function openSignup() {
    chip("soletrader").click();
    await flush();
    await flush();
    expect(popups).toHaveLength(1);
    return popups[0];
  }

  beforeEach(async () => {
    document.body.innerHTML = MARKUP;
    env = H.installHyvaEnvironment();
    H.loadRealCaptureModules(PLUGIN_DIR);
    popups = [];
    jest.spyOn(window, "open").mockImplementation(() => {
      const handle = { closed: false, close() { this.closed = true; }, focus() {} };
      popups.push(handle);
      return handle;
    });
    originalFetch = global.fetch;
    global.fetch = routedFetch;
    jest.spyOn(console, "error").mockImplementation(() => {});
    H.loadSharedHelpers();
    H.loadTemplate(H.COMPANY_NAME_TEMPLATE);
    env.fireAlpineInit();
    surface = H.mountComponent(env.alpineComponents[ADDRESS_COMPONENT], {
      el: field(),
      root: document.getElementById("billing-company-root"),
    });
    surface.init();
    await flush();
    await flush();
  });

  afterEach(() => {
    const capture = window.twoGatewayCompanyCaptureInstances.billing;
    if (capture && capture.soleTrader()) capture.soleTrader().dispose();
    if (capture && capture.panel()) capture.panel().destroy();
    global.fetch = originalFetch;
    env.restore();
    document.body.innerHTML = "";
  });

  test("the host adapter satisfies the real controller's contract", () => {
    expect(window.twoGatewayCompanyCaptureInstances.billing).toBeTruthy();
    expect(console.error).not.toHaveBeenCalled();
  });

  test("manual entry keeps the typed name and records manual entry", () => {
    window.twoGatewayCompanyIdentity("billing").write(
      { companyName: "Typed Name", companyId: "12345678" },
      { authoritative: true },
    );

    chip("manual").click();

    const record = JSON.parse(env.browserStorage.getItem(H.BILLING_COMPANY_KEY));
    expect([surface.manualMode, record.manual_mode, record.company_name, record.company_id])
      .toEqual([true, true, "Typed Name", ""]);
  });

  test("a Sole trader click pending over manual entry is still recorded as manual entry", async () => {
    window.twoGatewayCompanyIdentity("billing").companyName("Typed Name");
    chip("manual").click();

    await openSignup();

    const record = JSON.parse(env.browserStorage.getItem(H.BILLING_COMPANY_KEY));
    expect([surface.manualMode, record.manual_mode]).toEqual([true, true]);
  });

  test.each([
    ["a press on page content", { button: 0 }, false, true],
    ["a right press on page content", { button: 2 }, false, false],
    ["a press on page content after a Magewire re-render", { button: 0 }, true, true],
  ])("%s closes the signup popup: %p", async (why, init, morph, closes) => {
    const popup = await openSignup();
    if (morph) {
      // A re-render deletes the runtime-built popover and keeps the field.
      document.querySelectorAll(".two-company-field-wrap").forEach((wrap) => {
        wrap.parentNode.insertBefore(field(), wrap);
        wrap.remove();
      });
      env.fireMagewireHook("element.updated");
      surface.init();
    }

    press(document.getElementById("page-text"), init);
    await flush();

    expect([why, popup.closed]).toEqual([why, closes]);
  });
});
