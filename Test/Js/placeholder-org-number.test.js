/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25326, cross-platform requirement 12: an organisation number beginning
 * with the literal prefix `TWO:` is an INTERNAL placeholder, minted for a company
 * that has no number in its home registry. It is a real identifier as far as
 * every API call is concerned — it is what `payment[company_id]` submits and what
 * the order-intent request carries — but it is meaningless to a buyer, who reads
 * it as a registry number their company does not have. It must never reach the
 * screen.
 *
 * There are four display sites, and the requirement is explicit that they share
 * ONE helper rather than each testing the prefix: the results rows, the address
 * step's number display, the payment tile's `<name> (<number>)` label, and the
 * two order-intent verdict notices. Four separate prefix checks is how one of
 * them silently stops agreeing with the others, so this file asserts both the
 * helper's own contract AND that each site actually routes through it.
 *
 * The second half of the requirement is about the BRACKETS: where the number
 * normally appears parenthesised, the parentheses go with it. "Example Ltd ()"
 * reads as a rendering fault, so every site is checked for the name alone.
 */

"use strict";

const H = require("./hyva-harness");

const TILE_COMPONENT = "twoGatewayHyvaPaymentMethodBase";
const ADDRESS_COMPONENT = "twoGatewayHyvaCompanySearchField";

const NOTICE_COPY = {
  withCompany: "Approved for {{name}} ({{number}})",
  withoutCompany: "Approved",
  companyNameToken: "{{name}}",
  companyNumberToken: "{{number}}",
};

describe("placeholder organisation numbers are never shown (requirement 12)", () => {
  let env;
  let fetchStub;

  beforeEach(() => {
    env = H.installHyvaEnvironment();
    // Mounting a capture surface probes the registry for sole-trader
    // availability, so every site below needs a wire even where it asserts on
    // rendered text alone.
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});
    H.loadSharedHelpers();
    env.fireAlpineInit();
  });

  afterEach(() => {
    fetchStub.restore();
    env.restore();
    document.body.innerHTML = "";
  });

  describe("the one helper", () => {
    test("hides a placeholder identifier and keeps a real one", () => {
      const show = window.twoGatewayDisplayCompanyNumber;

      expect(show("TWO:ST-12345")).toBe("");
      expect(show("TWO:")).toBe("");
      expect(show("  TWO:abc  ")).toBe("");

      expect(show("123456789")).toBe("123456789");
      expect(show("  123456789 ")).toBe("123456789");
      // A registry number is allowed to contain the letters: only the exact
      // prefix in the exact position is the internal marker.
      expect(show("TWOSOME-1")).toBe("TWOSOME-1");
      expect(show("X-TWO:1")).toBe("X-TWO:1");
    });

    test("case-sensitively — the prefix is minted by us, always in one form", () => {
      // A case-insensitive test would also swallow a genuine registry number
      // that happened to start with the same three letters and a colon.
      expect(window.twoGatewayDisplayCompanyNumber("two:12345")).toBe(
        "two:12345",
      );
    });

    test("answers '' for every kind of absence, so callers need one branch", () => {
      const show = window.twoGatewayDisplayCompanyNumber;
      expect(show("")).toBe("");
      expect(show("   ")).toBe("");
      expect(show(null)).toBe("");
      expect(show(undefined)).toBe("");
      expect(show(12345)).toBe("");
    });
  });

  describe("site 1 — the search results rows", () => {
    /**
     * Run one search through the shared helper and return the mapped rows.
     *
     * @param {string} identifier value for `national_identifier.id`
     * @returns {Promise<Array>}
     */
    async function rowsFor(identifier) {
      const fetchStub = H.stubFetch();
      try {
        const pending = window.twoGatewayCompanySearch({
          restBaseUrl: "https://shop.test.invalid",
          countryCode: "GB",
          query: "example",
        });
        await H.flushPromises();
        fetchStub.last().respondProxy({
          items: [
            {
              name: "Example Trading Ltd",
              highlight: "<em>Example</em> Trading Ltd",
              national_identifier: { id: identifier },
              lookup_id: "lookup-1",
            },
          ],
        });
        const result = await pending;
        return result.items;
      } finally {
        fetchStub.restore();
        window.twoGatewayCompanySearchCache.clear();
      }
    }

    test("a placeholder number renders the name alone, brackets and all", async () => {
      const items = await rowsFor("TWO:ST-9999");

      expect(items[0].companyDisplayName).toBe("<em>Example</em> Trading Ltd");
      expect(items[0].companyDisplayName).not.toContain("TWO:");
      expect(items[0].companyDisplayName).not.toContain("(");
    });

    test("but the row still CARRIES it, because the order needs it", async () => {
      const items = await rowsFor("TWO:ST-9999");

      // Hiding it from the buyer must not drop it from the payload: this is the
      // value `payment[company_id]` and the intent request are built from.
      expect(items[0].companyId).toBe("TWO:ST-9999");
    });

    test("a real number is still shown, parenthesised", async () => {
      const items = await rowsFor("123456789");

      expect(items[0].companyDisplayName).toBe(
        "<em>Example</em> Trading Ltd (123456789)",
      );
    });
  });

  describe("site 2 — the address step's number display", () => {
    /**
     * @param {string} identifier
     * @returns {Object} a mounted address-step control with that pick restored
     */
    function withPick(identifier) {
      document.body.innerHTML = [
        '<div class="two-company-search" id="control-root" data-two-capture-host="address">',
        '  <input type="text" id="company-field" data-two-capture-field value="Example Trading Ltd" />',
        "</div>",
      ].join("\n");
      H.loadTemplate(H.COMPANY_NAME_TEMPLATE);
      env.fireAlpineInit();
      const root = document.getElementById("control-root");
      const component = H.mountComponent(env.alpineComponents[ADDRESS_COMPONENT], {
        el: document.getElementById("company-field"),
        root: root,
      });
      env.browserStorage.setItem(
        H.COMPANY_SELECTION_KEY,
        JSON.stringify({
          company_name: "Example Trading Ltd",
          company_id: identifier,
          company_id_source: "registry",
        }),
      );
      component.init();
      return component;
    }

    test("a placeholder number is not displayed, and its row is hidden entirely", () => {
      const component = withPick("TWO:ST-9999");

      expect(component.companyIdDisplayText).toBe("");
      // Not merely blank text in a visible, aria-labelled box — the whole
      // display comes down, or a screen reader announces "Company Number" with
      // nothing after it.
      expect(component.companyIdDisplayVisible).toBe(false);
    });

    test("a real registry number is displayed as before", () => {
      const component = withPick("123456789");

      expect(component.companyIdDisplayText).toBe("123456789");
      expect(component.companyIdDisplayVisible).toBe(true);
    });

    test("the display is BOUND to the filtered text, not the raw value", () => {
      // The whole point of the helper is that no site reads `companyId`
      // directly. A binding reverted to `companyId` would pass every assertion
      // above and still show the placeholder on the page.
      const binding = H.readAlpineBinding(
        H.COMPANY_NAME_MARKUP_TEMPLATE,
        ".two-company-id-display",
        "x-text",
      );
      expect(binding).toBe("companyIdDisplayText");
    });
  });

  describe("sites 3 and 4 — the payment tile's label and its intent notices", () => {
    /**
     * @param {string} identifier
     * @returns {Object} a mounted tile component holding that captured pair
     */
    function tileWith(identifier) {
      document.body.innerHTML = '<form id="two_payment_form"></form>';
      const form = document.getElementById("two_payment_form");
      const component = H.mountComponent(env.alpineComponents[TILE_COMPONENT], {
        el: form,
        root: form,
      });
      component.companyName = "Example Trading Ltd";
      component.companyId = identifier;
      component.orderIntentApprovedNoticeCopy = NOTICE_COPY;
      component.orderIntentNotAvailableCopy = NOTICE_COPY;
      return component;
    }

    test("the tile label shows the name alone, with no empty bracket pair", () => {
      const component = tileWith("TWO:ST-9999");

      expect(component.companyTileLabelText).toBe("Example Trading Ltd");
    });

    test("the tile label still parenthesises a real number", () => {
      const component = tileWith("123456789");

      expect(component.companyTileLabelText).toBe(
        "Example Trading Ltd (123456789)",
      );
    });

    test("both intent notices drop the number AND its brackets", () => {
      const component = tileWith("TWO:ST-9999");

      expect(component.resolveOrderIntentApprovedNotice()).toBe(
        "Approved for Example Trading Ltd",
      );
      expect(component.resolveOrderIntentNotAvailableNotice()).toBe(
        "Approved for Example Trading Ltd",
      );
    });

    test("a real number reaches both notices unchanged", () => {
      const component = tileWith("123456789");

      expect(component.resolveOrderIntentApprovedNotice()).toBe(
        "Approved for Example Trading Ltd (123456789)",
      );
      expect(component.resolveOrderIntentNotAvailableNotice()).toBe(
        "Approved for Example Trading Ltd (123456789)",
      );
    });

    test("the bracket strip is narrow — it does not eat the copy's own parentheses", () => {
      const component = tileWith("TWO:ST-9999");
      component.orderIntentApprovedNoticeCopy = {
        withCompany: "Approved for {{name}} ({{number}}) (invoice by email)",
        withoutCompany: "Approved",
        companyNameToken: "{{name}}",
        companyNumberToken: "{{number}}",
      };

      // Only an EMPTY bracket pair goes. A blanket paren-stripper would mangle
      // wording a translator is entitled to use.
      expect(component.resolveOrderIntentApprovedNotice()).toBe(
        "Approved for Example Trading Ltd (invoice by email)",
      );
    });

    test("the raw identifier still submits and still reaches the intent request", () => {
      document.body.innerHTML = [
        '<form id="two_payment_form">',
        '  <input type="text" id="company_name" name="payment[company_name]" value="" />',
        '  <input type="text" id="company_id" name="payment[company_id]" value="" />',
        "</form>",
      ].join("\n");
      const form = document.getElementById("two_payment_form");
      const component = H.mountComponent(env.alpineComponents[TILE_COMPONENT], {
        el: form,
        root: form,
      });
      component.quote = JSON.parse(H.QUOTE_JSON);

      component.fillCompanyData("TWO:ST-9999", "Example Trading Ltd", false);

      expect(document.getElementById("company_id").value).toBe("TWO:ST-9999");
      const body = component.buildOrderIntentRequestBody(component.quote);
      expect(body.buyer.company.organization_number).toBe("TWO:ST-9999");
    });
  });
});
