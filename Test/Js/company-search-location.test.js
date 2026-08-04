/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25326 §7.1-§7.3, 2026-08-03 ruling. Exactly ONE company-search control
 * per platform; an admin setting (CheckoutConfig::getCompanySearchLocation())
 * decides WHERE it renders — address area, or payment tile — never whether
 * it exists.
 *
 * Every other suite in this directory over these two templates predates the
 * ruling and keeps testing each control's OWN behaviour as if it were the
 * active one (see the harness's per-file default in hyva-harness.js for why).
 * This file is the one place that asserts on the LOCATION SWITCH itself: the
 * production default (address-area) leaves the tile text-only with no
 * duplicate control, and the opposite setting leaves the address step with a
 * plain, unenhanced field rather than a second rich one.
 */

"use strict";

const H = require("./hyva-harness");

const PAYMENT_TILE_TRUE = [[/^\$isCompanySearchInPaymentTile$/, "1"]];
// gateway_method*.phtml's harness DEFAULT is payment_tile=true (see
// hyva-harness.js's per-file default and its comment for why) — the opposite
// of production's actual default. This override is what makes THIS test
// exercise the real production default rather than the harness's
// legacy-preserving one.
const ADDRESS_AREA = [[/^\$isCompanySearchInPaymentTile$/, ""]];

describe("company-search location (TWO-25326 §7.1, 2026-08-03 ruling)", () => {
  describe("default (address-area) configuration", () => {
    test("the payment tile has no editable company controls at all", () => {
      const markup = H.renderTemplateMarkup(
        H.GATEWAY_METHOD_MARKUP_TEMPLATE,
        ADDRESS_AREA,
      );
      const doc = new DOMParser().parseFromString(markup, "text/html");

      expect(doc.querySelector('[data-name="company_tile_label"]')).toBeNull();
      expect(
        doc.querySelector('[data-name="company_tile_change"]'),
      ).toBeNull();
      expect(doc.querySelector('input[name="payment[company_name]"]')).not
        .toBeNull();
      expect(
        doc.querySelector('input[name="payment[company_name]"]').type,
      ).toBe("hidden");
      expect(doc.querySelector('input[name="payment[company_id]"]')).not
        .toBeNull();
      expect(
        doc.querySelector('input[name="payment[company_id]"]').type,
      ).toBe("hidden");
      // No visible/enhanced search markup at all in this mode.
      expect(doc.querySelector(".two-company-search")).toBeNull();
      expect(doc.querySelector('[data-manual="true"]')).toBeNull();
    });

    test("the not-available notice element exists, gated on the same brand switch as the approved one", () => {
      const showBinding = H.readAlpineBinding(
        H.GATEWAY_METHOD_MARKUP_TEMPLATE,
        '[data-name="order_intent_not_available_message"]',
        "x-show",
      );
      const textBinding = H.readAlpineBinding(
        H.GATEWAY_METHOD_MARKUP_TEMPLATE,
        '[data-name="order_intent_not_available_message"]',
        "x-text",
      );

      expect(showBinding).toBe("twoTileNotAvailableVisible");
      expect(textBinding).toBe("orderIntentNotAvailableNotice");
    });

    test("the address-step control is the one that renders — its Alpine root is present", () => {
      const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
      const doc = new DOMParser().parseFromString(markup, "text/html");

      const root = doc.querySelector(".two-company-search");
      expect(root).not.toBeNull();
      expect(root.getAttribute("x-data")).toBe(
        "twoGatewayHyvaCompanySearchField",
      );
    });
  });

  describe("payment-tile configuration (admin setting flipped)", () => {
    test("the payment tile keeps its own rich control (unchanged from every other suite in this directory)", () => {
      const markup = H.renderTemplateMarkup(
        H.GATEWAY_METHOD_MARKUP_TEMPLATE,
        PAYMENT_TILE_TRUE,
      );
      const doc = new DOMParser().parseFromString(markup, "text/html");

      expect(doc.querySelector('[data-name="company_tile_label"]')).not
        .toBeNull();
      expect(doc.querySelector(".two-company-search")).not.toBeNull();
    });

    test("the address step degrades to a plain, unenhanced field — no second rich control", () => {
      const markup = H.renderTemplateMarkup(
        H.COMPANY_NAME_MARKUP_TEMPLATE,
        PAYMENT_TILE_TRUE,
      );
      const doc = new DOMParser().parseFromString(markup, "text/html");

      // No Alpine component, no dropdown, no spinner, no mode toggling.
      expect(doc.querySelector(".two-company-search")).toBeNull();
      expect(doc.querySelector("[x-data]")).toBeNull();

      const input = doc.querySelector('input[type="text"]');
      expect(input).not.toBeNull();
      // renderAttributes() carries the real entity-field name — the harness
      // fixture value, but the point is that it comes from THAT call and not
      // from anything company-search specific.
      expect(input.getAttribute("name")).toBe("company");
    });
  });

  describe("resolveOrderIntentNotAvailableNotice() (TWO-25326 §7.3 wording)", () => {
    const NOT_AVAILABLE_COPY = {
      withCompany: "Two is not available for this order by {name} ({id}).",
      withoutCompany: "Two is not available for this order.",
      companyNameToken: "{name}",
      companyNumberToken: "{id}",
    };

    const COMPONENT_NAME = "twoGatewayHyvaPaymentMethodBase";

    let env;
    let component;

    beforeEach(() => {
      document.body.innerHTML = '<div id="payment-root"></div>';

      env = H.installHyvaEnvironment();
      H.loadTemplate(H.GATEWAY_METHOD_TEMPLATE);
      env.fireAlpineInit();

      const root = document.getElementById("payment-root");
      component = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
        el: root,
        root: root,
      });
    });

    afterEach(() => {
      env.restore();
    });

    test("substitutes both the company name and number tokens", () => {
      component.orderIntentNotAvailableCopy = NOT_AVAILABLE_COPY;
      component.companyName = "Example Trading Ltd";
      component.companyId = "123456789";

      expect(component.resolveOrderIntentNotAvailableNotice()).toBe(
        "Two is not available for this order by Example Trading Ltd (123456789).",
      );
    });

    test("falls back to the without-company copy when no name is known", () => {
      component.orderIntentNotAvailableCopy = NOT_AVAILABLE_COPY;
      component.companyName = "";
      component.companyId = "";

      expect(component.resolveOrderIntentNotAvailableNotice()).toBe(
        "Two is not available for this order.",
      );
    });

    test("returns '' when the brand switched the notice off (copy is null)", () => {
      component.orderIntentNotAvailableCopy = null;
      component.companyName = "Example Trading Ltd";

      expect(component.resolveOrderIntentNotAvailableNotice()).toBe("");
    });

    test("a declined order intent sets the persistent not-available notice, alongside the toast", () => {
      component.orderIntentNotAvailableCopy = NOT_AVAILABLE_COPY;
      component.companyName = "Example Trading Ltd";
      component.companyId = "123456789";

      component.processOrderIntentSuccessResponse({ approved: false });

      expect(component.orderIntentNotAvailableNotice).toBe(
        "Two is not available for this order by Example Trading Ltd (123456789).",
      );
      expect(component.twoTileNotAvailableVisible).toBe(true);
    });

    test("an approved intent clears any leftover not-available notice", () => {
      component.orderIntentNotAvailableCopy = NOT_AVAILABLE_COPY;
      component.orderIntentApprovedNoticeCopy = {
        withCompany: "Approved: {name}.",
        withoutCompany: "Approved.",
        companyNameToken: "{name}",
        companyNumberToken: "{id}",
      };
      component.companyName = "Example Trading Ltd";
      component.companyId = "123456789";

      component.processOrderIntentSuccessResponse({ approved: false });
      expect(component.twoTileNotAvailableVisible).toBe(true);

      component.processOrderIntentSuccessResponse({ approved: true });
      expect(component.orderIntentNotAvailableNotice).toBe("");
      expect(component.twoTileNotAvailableVisible).toBe(false);
    });
  });
});
