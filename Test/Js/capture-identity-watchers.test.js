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

  describe("a surface re-mounted on the root it already held", () => {
    test("replaces its subscription rather than adding a second", () => {
      // The Magewire case: the morph keeps the node carrying the `x-data`, so a
      // re-mount arrives on the SAME root. The departed-root sweep cannot reach
      // this one — it is still connected — so only the same-key dispose retires
      // the old subscription, and two live subscriptions on the claim-holder
      // persist the blob and announce the pick twice per notification.
      mountAddressControl("shipping");
      mountAddressControl("billing");
      const remounted = mountAddressControl("shipping");

      env.identity.write(
        { companyName: "Example Trading Ltd", companyId: "12345678" },
        { authoritative: true },
      );

      expect(announced).toHaveLength(1);
      expect(remounted.companyName).toBe("Example Trading Ltd");
    });
  });

  describe("the surface that holds no claim", () => {
    /** @param {Object} record the persisted shipping selection to plant */
    function storeSelection(record) {
      env.browserStorage.setItem(
        H.COMPANY_SELECTION_KEY,
        JSON.stringify(record),
      );
    }

    test("may not displace a capture the claim-holder made", () => {
      // Both surfaces read the one shipping record, and the invoice form's copy
      // of it is routinely the company that preceded the live capture.
      mountAddressControl("shipping");
      env.identity.write(
        {
          companyName: "Delivery Form Ltd",
          companyId: "88888888",
          companyIdSource: "registry",
        },
        { authoritative: true },
      );
      storeSelection({
        company_name: "Stored Record Ltd",
        company_id: "77777777",
        company_id_source: "registry",
      });

      mountAddressControl("billing");

      expect(env.identity.companyName()).toBe("Delivery Form Ltd");
      expect(env.identity.companyId()).toBe("88888888");
    });

    test("seeds an uncaptured identity non-authoritatively", () => {
      // An authoritative write replaces both halves, empty ones included, so
      // seeding with one is how a half nobody stored blanks a live one.
      mountAddressControl("shipping");
      storeSelection({ company_name: "Stored Record Ltd", company_id: "" });
      const options = [];
      const write = env.identity.write;
      env.identity.write = function (written, given) {
        options.push(given);
        return write.call(env.identity, written, given);
      };

      mountAddressControl("billing");

      expect(options).not.toHaveLength(0);
      expect(options.every((given) => !(given && given.authoritative))).toBe(
        true,
      );
    });
  });

  describe("ownership resolved at NOTIFICATION time, not at subscribe time", () => {
    test("a displaced surface stops persisting and announcing", () => {
      // The invoice-role form mounts SECOND here, so it displaces the claim the
      // delivery form took first. An ownership answer captured when the
      // subscription was opened leaves the ex-owner persisting the blob,
      // announcing the pick and raising an order intent alongside the real owner.
      const displaced = mountAddressControl("billing");
      expect(
        document
          .getElementById("billing-company-field")
          .hasAttribute("data-two-capture-active"),
      ).toBe(true);

      mountAddressControl("shipping");
      expect(
        document
          .getElementById("billing-company-field")
          .hasAttribute("data-two-capture-active"),
      ).toBe(false);

      env.identity.write(
        { companyName: "Example Trading Ltd", companyId: "12345678" },
        { authoritative: true },
      );

      expect(announced).toHaveLength(1);
      // Still MIRRORED — the displaced surface paints from the identity too.
      expect(displaced.companyName).toBe("Example Trading Ltd");
    });
  });

  describe("the tile's submit fields, on a notification a surface does not own", () => {
    /**
     * A claim held by neither mounted surface, inside the invoice-role form so
     * that form's own surface defers to it rather than displacing it.
     */
    function plantForeignClaim() {
      const holder = document.createElement("input");
      holder.type = "text";
      holder.id = "foreign-claim";
      holder.setAttribute("data-two-capture-active", "");
      document.getElementById("shipping-form").appendChild(holder);
    }

    /** The payment tile's own pair, which is what actually submits. */
    function plantSubmitFields() {
      const pair = document.createElement("div");
      pair.innerHTML =
        '<input id="company_name" value="Tile Company Ltd" />' +
        '<input id="company_id" value="99999999" />';
      document.body.appendChild(pair);
    }

    test("survive an empty-name notification", () => {
      // Given a claim neither surface holds, and a tile holding its own company.
      plantForeignClaim();
      plantSubmitFields();
      mountAddressControl("shipping");
      mountAddressControl("billing");
      expect(
        document.querySelectorAll("input[data-two-capture-active]"),
      ).toHaveLength(1);

      // When the shared identity is discarded.
      env.identity.write(
        { companyName: "Example Trading Ltd", companyId: "12345678" },
        { authoritative: true },
      );
      env.identity.clear();

      // Then the tile's pair is untouched: blanking it is the OWNER's move, and
      // neither of these surfaces is the owner.
      expect(document.getElementById("company_name").value).toBe(
        "Tile Company Ltd",
      );
      expect(document.getElementById("company_id").value).toBe("99999999");
    });
  });

  describe("a claim no longer standing", () => {
    /** @param {Object} record the persisted shipping selection to plant */
    function storeSelection(record) {
      env.browserStorage.setItem(
        H.COMPANY_SELECTION_KEY,
        JSON.stringify(record),
      );
    }

    beforeEach(() => {
      mountAddressControl("shipping");
      env.identity.write(
        {
          companyName: "Delivery Form Ltd",
          companyId: "88888888",
          companyIdSource: "registry",
        },
        { authoritative: true },
      );
      // A morph reinstates the server markup, which carries no claim. Asking
      // "do I own this?" in that window must not be what answers yes.
      document
        .getElementById("shipping-company-field")
        .removeAttribute("data-two-capture-active");
      storeSelection({
        company_name: "Stored Record Ltd",
        company_id: "77777777",
        company_id_source: "registry",
        manual_mode: true,
      });
    });

    test("does not let a mounting surface displace the live capture", () => {
      mountAddressControl("billing");

      expect(env.identity.companyName()).toBe("Delivery Form Ltd");
      expect(env.identity.companyId()).toBe("88888888");
    });

    test("does not let it impose the stored MODE either", () => {
      // The mode is persisted alongside the pair and decides which control the
      // buyer is shown; adopted from a surface holding nothing it opens a
      // live-looking search box whose every keystroke returns early.
      mountAddressControl("billing");

      expect(env.identity.captureMode()).toBe("registered");
    });
  });

  describe("a surface whose root has left the document", () => {
    test("is torn down by the re-render, with no other mount involved", () => {
      // The teardown has to hang off the event that REMOVED the surface. Left
      // to the departed-root sweep inside the next mount, a Magewire-removed
      // surface goes on writing storage and dispatching cross-step events until
      // some other surface happens to mount — which on a page with one control
      // is never.
      const departed = mountAddressControl("shipping");
      document.getElementById("shipping-form").remove();

      env.fireMagewireHook("element.updated");
      env.identity.write(
        { companyName: "Example Trading Ltd", companyId: "12345678" },
        { authoritative: true },
      );

      expect(departed.companyName).toBe("");
      expect(storedSelection().company_name).toBeUndefined();
      expect(announced).toHaveLength(0);
    });

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
