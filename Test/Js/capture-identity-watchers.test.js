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
  let announced;
  let announceListener;

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
    const component = H.mountComponent(env.alpineComponents[ADDRESS_COMPONENT], {
      el: document.getElementById(role + "-company-field"),
      root: document.getElementById(role + "-company-root"),
    });
    component.init();
    return component;
  }

  /** @returns {Object} the persisted shipping selection */
  function storedSelection() {
    return JSON.parse(
      env.browserStorage.getItem(H.COMPANY_SELECTION_KEY) || "{}",
    );
  }

  beforeEach(() => {
    // No `#billing-as-shipping`, so the invoice role is the DELIVERY form, and
    // it mounts FIRST — the arrangement in which a key shared between the two
    // surfaces leaves the owner with no watcher.
    document.body.innerHTML = addressForm("shipping") + addressForm("billing");

    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});
    H.loadSharedHelpers();
    H.loadTemplate(H.COMPANY_NAME_TEMPLATE);
    env.fireAlpineInit();

    announced = [];
    announceListener = (event) => announced.push(event.detail);
    window.addEventListener("shipping-company-selected", announceListener);
  });

  afterEach(() => {
    window.removeEventListener("shipping-company-selected", announceListener);
    fetchStub.restore();
    env.restore();
    jest.restoreAllMocks();
    document.body.innerHTML = "";
  });

  describe("a company captured after both have mounted", () => {
    let surfaces;

    beforeEach(() => {
      surfaces = {
        shipping: mountAddressControl("shipping"),
        billing: mountAddressControl("billing"),
      };
      // Given both mounted; when the shared identity takes a pick.
      env.identity.write(
        { companyName: "Example Trading Ltd", companyId: "12345678" },
        { authoritative: true },
      );
    });

    test("the owner holds the claim, and the other defers", () => {
      expect(
        document.getElementById("shipping-company-field").hasAttribute(
          "data-two-capture-active",
        ),
      ).toBe(true);
      expect(
        document.querySelectorAll("input[data-two-capture-active]"),
      ).toHaveLength(1);
    });

    test("reaches BOTH surfaces' mirrors", () => {
      // One test, not a row each: only the surface mounted FIRST can lose its
      // subscription to a shared key, so the symmetry is the property.
      expect(surfaces.shipping.companyName).toBe("Example Trading Ltd");
      expect(surfaces.shipping.companyId).toBe("12345678");
      expect(surfaces.billing.companyName).toBe("Example Trading Ltd");
      expect(surfaces.billing.companyId).toBe("12345678");
    });

    test("and the owner persists it and announces it", () => {
      expect(storedSelection().company_name).toBe("Example Trading Ltd");
      expect(storedSelection().company_id).toBe("12345678");
      expect(announced).toHaveLength(1);
      expect(announced[0].company_name).toBe("Example Trading Ltd");
    });
  });

  describe("a surface whose root has left the document", () => {
    test("stops being written to once another mount has swept", () => {
      const departed = mountAddressControl("shipping");
      document.getElementById("shipping-form").remove();

      const arrived = mountAddressControl("billing");
      env.identity.write(
        { companyName: "Example Trading Ltd", companyId: "12345678" },
        { authoritative: true },
      );

      expect(departed.companyName).toBe("");
      expect(departed.companyId).toBe("");
      // The sweep disposed a subscription, not every subscription.
      expect(arrived.companyName).toBe("Example Trading Ltd");
      expect(storedSelection().company_name).toBe("Example Trading Ltd");
    });
  });
});
