/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-27220: the company field's tab stop while the shared popover is open,
 * pinned on each Hyvä surface that mounts that popover.
 *
 * The behaviour belongs to the base plugin's popover, and this checkout only
 * inherits it: while the popover is open the company-name field it opened from
 * carries `tabindex="-1"`, and once it closes the field gets back exactly what it
 * had before (no attribute at all on this checkout's markup, a theme's own value
 * where a theme set one). Without that the field's open-on-focus opener and the
 * query box trade focus on Shift+Tab, a keyboard trap. A mount here that wrote a
 * `tabindex` of its own onto the field would fight it, so the surfaces are
 * mounted from their REAL markup over the REAL shared modules, and nothing here
 * calls the panel directly: it is opened and closed the buyer's way.
 *
 * NOT COVERED HERE: the keyboard traversal itself. jsdom has no sequential focus
 * navigation, so this asserts the attribute the browser derives tab order from,
 * never the absence of a trap. That needs a real browser.
 *
 * The address-book modal is not here: it renders Hyvä Checkout's own dropdown,
 * not the shared popover.
 *
 * The modules are not in this repo, so, like `shared-modules-smoke`, the suite
 * runs only when TWO_MAGENTO_PLUGIN_DIR names a magento-plugin checkout (CI
 * gives it base staging) and is skipped, saying so in its name, without one.
 *
 *   TWO_MAGENTO_PLUGIN_DIR=../magento-plugin npm run test:js -- company-field-tab-stop
 */

"use strict";

const H = require("./hyva-harness");

const PLUGIN_DIR = process.env.TWO_MAGENTO_PLUGIN_DIR || "";
const describeReal = PLUGIN_DIR ? describe : describe.skip;

const FIELD = "input[data-two-capture-field]";
const PANEL = ".two-company-dropdown";
const QUERY = ".two-company-dropdown__query";
const ROW = ".two-company-dropdown__row";

/** The relays a mount and a search call; anything else answers 404. */
const ROUTES = [
  ["supported-company-types", ["SOLE_TRADER", "LIMITED_COMPANY"]],
  [
    "supported-countries",
    [
      JSON.stringify({
        ok: true,
        status: 200,
        body: { supported_countries: ["gb", "GB"] },
      }),
    ],
  ],
  [
    "company-search",
    [
      JSON.stringify({
        ok: true,
        status: 200,
        body: {
          items: [
            {
              name: "Example Trading Ltd",
              highlight: "<em>Example</em> Trading Ltd",
              national_identifier: { id: "12345678" },
              lookup_id: "lookup-1",
            },
          ],
        },
      }),
    ],
  ],
];

function routedFetch(url) {
  const route = ROUTES.find((entry) => String(url).includes(entry[0]));
  const body = route ? route[1] : null;
  return Promise.resolve({
    ok: Boolean(body),
    status: body ? 200 : 404,
    headers: { get: () => null },
    json: () => Promise.resolve(body || {}),
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms || 0));
}

/** Outside every company control, for the press that closes the popover. */
const PAGE_TEXT = '<div id="page-text">page text</div>';

/**
 * The address step: the field renderer's real markup inside an invoice
 * address form, mounted as the renderer's own component.
 */
function mountAddressSurface(env) {
  document.body.innerHTML = [
    '<form id="billing-form">',
    '  <select id="billing-country_id" name="billing[country_id]">',
    '    <option value="GB" selected>GB</option>',
    "  </select>",
    H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE),
    "</form>",
    PAGE_TEXT,
  ].join("\n");
  H.loadTemplate(H.COMPANY_NAME_TEMPLATE);
  env.fireAlpineInit();
  const root = document.querySelector('[data-two-capture-host="address"]');
  const surface = H.mountComponent(
    env.alpineComponents.twoGatewayHyvaCompanySearchField,
    { el: root.querySelector(FIELD), root: root },
  );
  surface.init();
}

/**
 * The payment tile: the tile's real markup, mounted as the payment form's
 * component, which owns the control (it has no `x-data` of its own).
 */
function mountTileSurface(env) {
  const markup = H.renderTemplateMarkup(H.GATEWAY_METHOD_MARKUP_TEMPLATE);
  document.body.innerHTML = [
    '<input type="radio" name="payment-method-option" value="two_payment" checked />',
    '<input id="shipping-country_id" value="GB" />',
    // Production emits no `x-data` here; the harness renders the address
    // step's value into both mount points.
    markup.replace(/x-data="twoGatewayHyvaCompanySearchField"/, ""),
    PAGE_TEXT,
  ].join("\n");
  H.loadTemplate(H.GATEWAY_METHOD_TEMPLATE);
  env.fireAlpineInit();
  const form = document.getElementById("two_payment_form");
  const component = H.mountComponent(
    env.alpineComponents.twoGatewayHyvaPaymentMethodBase,
    { el: form, root: form },
  );
  component.$watch = function () {};
  component.initialize(JSON.parse(H.QUOTE_JSON));
}

const SURFACES = [
  ["the address step's company field", mountAddressSurface],
  ["the payment tile's company field", mountTileSurface],
];

describeReal.each(SURFACES)(
  `%s${PLUGIN_DIR ? "" : " (set TWO_MAGENTO_PLUGIN_DIR)"}`,
  (surfaceName, mountSurface) => {
    let env;
    let originalFetch;

    function field() {
      return document.querySelector(FIELD);
    }

    function panelIsOpen() {
      const panel = document.querySelector(PANEL);
      return Boolean(panel) && !panel.hasAttribute("hidden");
    }

    function press(target) {
      target.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
    }

    /** Opened the buyer's way, never through the panel's own API. */
    const OPENERS = [
      ["a press on the field", () => press(field())],
      ["focus arriving on the field", () => field().focus()],
    ];

    /** Each close the buyer can reach, and what it leaves focused. */
    const CLOSES = [
      [
        "Escape in the query box",
        () => {
          document.querySelector(QUERY).dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              bubbles: true,
              cancelable: true,
            }),
          );
        },
      ],
      [
        "a press outside the control",
        () => press(document.getElementById("page-text")),
      ],
      [
        "taking a search result",
        async () => {
          const query = document.querySelector(QUERY);
          query.value = "Example";
          query.dispatchEvent(new Event("input", { bubbles: true }));
          // The panel's debounce, then the relay's promise chain.
          await wait(350);
          await H.flushPromises();
          const row = document.querySelector(ROW);
          // Positive control: a missing row would close nothing and fail
          // below for the wrong reason.
          expect(row).not.toBeNull();
          press(row);
          await H.flushPromises();
          // Positive control: the close came from the pick, not something else.
          expect(field().value).toBe("Example Trading Ltd");
        },
      ],
    ];

    beforeEach(async () => {
      env = H.installHyvaEnvironment();
      H.loadRealCaptureModules(PLUGIN_DIR);
      originalFetch = global.fetch;
      global.fetch = routedFetch;
      jest.spyOn(console, "error").mockImplementation(() => {});
      // The address lookup after a pick answers 404 here, and says so.
      jest.spyOn(console, "warn").mockImplementation(() => {});
      H.loadSharedHelpers();
      mountSurface(env);
      await wait();
      await wait();
      // Positive control: every case below is about this panel.
      expect(document.querySelector(PANEL)).not.toBeNull();
    });

    afterEach(() => {
      Object.values(window.twoGatewayCompanyCaptureInstances || {}).forEach(
        (capture) => {
          if (capture.soleTrader()) capture.soleTrader().dispose();
          if (capture.panel()) capture.panel().destroy();
        },
      );
      global.fetch = originalFetch;
      env.restore();
      document.body.innerHTML = "";
    });

    test("the mounted field carries no tabindex of its own", () => {
      expect(panelIsOpen()).toBe(false);
      expect(field().hasAttribute("tabindex")).toBe(false);
    });

    test.each(OPENERS)(
      "the open popover holds the field out of the tab order (%s)",
      (why, open) => {
        open();

        expect(panelIsOpen()).toBe(true);
        expect(field().getAttribute("tabindex")).toBe("-1");
      },
    );

    test.each(CLOSES)(
      "closing gives the field its tab stop back (%s)",
      async (why, close) => {
        press(field());
        expect(field().getAttribute("tabindex")).toBe("-1");

        await close();

        expect(panelIsOpen()).toBe(false);
        expect(field().hasAttribute("tabindex")).toBe(false);
      },
    );

    test("Escape hands focus back to the field it took out of the order", () => {
      press(field());
      document.querySelector(QUERY).focus();

      document.querySelector(QUERY).dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );

      // Why `-1` rather than taking the field out some other way: it stays
      // focusable from script, so the close can still hand the caret back.
      expect(document.activeElement).toBe(field());
      expect(field().hasAttribute("tabindex")).toBe(false);
    });

    test("a theme's own tabindex is given back exactly, not removed", () => {
      field().setAttribute("tabindex", "3");

      press(field());
      expect(field().getAttribute("tabindex")).toBe("-1");
      press(document.getElementById("page-text"));

      expect(panelIsOpen()).toBe(false);
      expect(field().getAttribute("tabindex")).toBe("3");
    });

    test("a second open and close leaves the field as the first did", () => {
      for (let i = 0; i < 2; i += 1) {
        press(field());
        expect(field().getAttribute("tabindex")).toBe("-1");
        press(document.getElementById("page-text"));
        expect(field().hasAttribute("tabindex")).toBe(false);
      }
    });
  },
);
