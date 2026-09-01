/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * The identity-watcher registry, keyed on each surface's own ROOT NODE.
 *
 * Each surface's root node is its own key: the address renderer mounts on the
 * delivery form AND the invoice form, so a key naming the kind of host would be
 * shared between them, and the second mount would dispose the first's
 * subscription.
 *
 * Both surfaces mount before anything is written: a write is the only thing that
 * tells a live subscription from a disposed one.
 */

"use strict";

const H = require("./hyva-harness");

const ADDRESS_COMPONENT = "twoGatewayHyvaCompanySearchField";

describe("two address surfaces on one page", () => {
  let env;
  let fetchStub;

  /**
   * One address form: its own country field, the address inputs the invoice-role
   * resolver looks for, and its own company-search control.
   *
   * @param {string} role "shipping" or "billing"
   * @returns {string}
   */
  function addressForm(role) {
    return [
      '<form id="' + role + '-form">',
      '  <select id="' + role + '-country_id" name="' + role + '[country_id]">',
      '    <option value="GB" selected>x</option>',
      "  </select>",
      '  <input name="city" value="" />',
      '  <div id="' +
        role +
        '-company-root" class="two-company-search" data-two-capture-host="address">',
      '    <input type="text" id="' +
        role +
        '-company-field" data-two-capture-field value="" />',
      "  </div>",
      "</form>",
    ].join("\n");
  }

  /**
   * @param {string} role
   * @returns {Object} the mounted, initialised surface
   */
  function mountAddressControl(role) {
    const component = H.mountComponent(
      env.alpineComponents[ADDRESS_COMPONENT],
      {
        el: document.getElementById(role + "-company-field"),
        root: document.getElementById(role + "-company-root"),
      },
    );
    component.init();
    return component;
  }

  /** @returns {Object} the persisted address-step selection */
  function storedSelection() {
    return JSON.parse(
      env.browserStorage.getItem(H.COMPANY_SELECTION_KEY) || "{}",
    );
  }

  /** The invoice panel's own record — a separate key, so a pick cannot cross. */
  function storedBillingSelection() {
    return JSON.parse(
      env.browserStorage.getItem(H.BILLING_COMPANY_KEY) || "{}",
    );
  }

  /**
   * Capture a company on one role.
   *
   * @param {string} role
   * @param {string} name
   * @param {string} id
   */
  function capture(role, name, id) {
    env
      .identityFor(role)
      .write({ companyName: name, companyId: id }, { authoritative: true });
  }

  beforeEach(() => {
    document.body.innerHTML = addressForm("shipping") + addressForm("billing");

    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});
    H.loadSharedHelpers();
    H.loadTemplate(H.COMPANY_NAME_TEMPLATE);
    env.fireAlpineInit();
  });

  afterEach(() => {
    fetchStub.restore();
    env.restore();
    jest.restoreAllMocks();
    document.body.innerHTML = "";
  });

  describe("a company captured on one role, after both have mounted", () => {
    let surfaces;

    beforeEach(() => {
      surfaces = {
        shipping: mountAddressControl("shipping"),
        billing: mountAddressControl("billing"),
      };
      capture("shipping", "Example Trading Ltd", "12345678");
    });

    test("reaches that role's surface, and persists", () => {
      expect(surfaces.shipping.companyName).toBe("Example Trading Ltd");
      expect(surfaces.shipping.companyId).toBe("12345678");
      expect(storedSelection().company_name).toBe("Example Trading Ltd");
      expect(storedSelection().company_id).toBe("12345678");
    });

    test.each([
      ["companyName", ""],
      ["companyId", ""],
    ])("leaves the other role's surface %s at %p", (key, expected) => {
      expect(surfaces.billing[key]).toBe(expected);
    });

    test("leaves the other role's identity empty", () => {
      expect(env.identityFor("billing").companyName()).toBe("");
      expect(env.identityFor("billing").companyId()).toBe("");
    });

    test("the other role's field is untouched", () => {
      expect(document.getElementById("billing-company-field").value).toBe("");
    });
  });

  describe("a surface re-mounted on the root it already held", () => {
    test("replaces its subscription rather than adding a second", () => {
      // The Magewire case: the morph keeps the node carrying the `x-data`, so a
      // re-mount arrives on the SAME root. The departed-root sweep cannot reach
      // this one — it is still connected — so only the same-key dispose retires
      // the old subscription, and two live subscriptions persist the blob twice
      // on every notification.
      mountAddressControl("shipping");
      mountAddressControl("billing");
      const remounted = mountAddressControl("shipping");
      const writes = jest.spyOn(env.browserStorage, "setItem");

      capture("shipping", "Example Trading Ltd", "12345678");

      expect(writes).toHaveBeenCalledTimes(1);
      expect(remounted.companyName).toBe("Example Trading Ltd");
    });
  });

  describe("a surface whose root has left the document", () => {
    test("is torn down by the re-render, with no other mount involved", () => {
      // The teardown has to hang off the event that REMOVED the surface. Left
      // to the departed-root sweep inside the next mount, a Magewire-removed
      // surface goes on writing storage until some other surface happens to
      // mount — which on a page with one control is never.
      const departed = mountAddressControl("shipping");
      document.getElementById("shipping-form").remove();

      env.fireMagewireHook("element.updated");
      capture("shipping", "Example Trading Ltd", "12345678");

      expect(departed.companyName).toBe("");
      expect(storedSelection().company_name).toBeUndefined();
    });

    test("stops being written to once another mount has swept", () => {
      const departed = mountAddressControl("shipping");
      document.getElementById("shipping-form").remove();

      const arrived = mountAddressControl("billing");
      capture("shipping", "Example Trading Ltd", "12345678");
      capture("billing", "Invoice Form Ltd", "88888888");

      expect(departed.companyName).toBe("");
      expect(departed.companyId).toBe("");
      // The sweep disposed a subscription, not every subscription.
      expect(arrived.companyName).toBe("Invoice Form Ltd");
      expect(storedBillingSelection().company_name).toBe("Invoice Form Ltd");
      expect(storedSelection().company_name).toBeUndefined();
    });
  });
});
