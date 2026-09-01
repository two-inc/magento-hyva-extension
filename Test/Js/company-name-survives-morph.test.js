/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * A captured company stays IN THE FIELD across a Magewire re-render.
 *
 * The morph puts the server's markup back over the live control, and the
 * server's `value` for the company field is whatever the last roundtrip knew —
 * empty for a company the buyer picked a moment ago. The company is still in
 * the identity, so every assertion made on component STATE passes while the
 * buyer is looking at an empty field: the reported symptom was the name
 * vanishing a few seconds after the pick, which is the address form's autosave
 * roundtrip landing.
 *
 * Both panels, because each morphs on its own roundtrip.
 */

"use strict";

const H = require("./hyva-harness");

const COMPONENT_NAME = "twoGatewayHyvaCompanySearchField";

const COMPANIES = {
  shipping: { companyName: "Delivery Ltd", companyId: "11111111" },
  billing: { companyName: "Invoice GmbH", companyId: "22222222" },
};

describe("a captured company survives the morph that blanks its field", () => {
  let env;
  let fetchStub;

  /**
   * One address panel, with the country select its role is read from.
   *
   * @param {string} role
   * @returns {string}
   */
  function addressPanel(role) {
    return [
      '<form id="' + role + '-form">',
      '  <select id="' + role + '-country_id" name="' + role + '[country_id]">',
      '    <option value="GB" selected>x</option>',
      "  </select>",
      "  <div><div><div>",
      '  <div id="' +
        role +
        '-company-root" class="two-company-search"' +
        ' data-two-capture-host="address" data-two-capture-role="">',
      '    <input type="text" id="' +
        role +
        '-company-field" data-two-capture-field value="" />',
      "  </div>",
      "  </div></div></div>",
      "</form>",
    ].join("\n");
  }

  /**
   * @param {string} role
   * @returns {Object} the mounted surface
   */
  function mountPanel(role) {
    const component = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
      el: document.getElementById(role + "-company-field"),
      root: document.getElementById(role + "-company-root"),
    });
    component.init();
    return component;
  }

  /**
   * @param {string} role
   * @returns {HTMLInputElement}
   */
  function nameField(role) {
    return document.getElementById(role + "-company-field");
  }

  /**
   * A re-render rewrites the company input from the server's own value, which
   * for a company picked since the last roundtrip is the empty one the page was
   * rendered with. This is the whole of what the reported bug needs: the
   * popover's wrapper is untouched, so nothing gated on the popover still being
   * bound can see it.
   *
   * @param {string} role
   */
  function morphFieldValueOnly(role) {
    nameField(role).value = "";
  }

  /**
   * The same roundtrip when the morph also reinstates the structure around the
   * field: the runtime wrapper is in no server markup so it goes, and the role
   * stamp the mount selector is scoped on goes with it.
   *
   * @param {string} role
   */
  function morphWholeControl(role) {
    const root = document.getElementById(role + "-company-root");
    const field = nameField(role);
    const wrap = field.parentElement;
    if (wrap !== root) {
      root.insertBefore(field, wrap);
      wrap.remove();
    }
    root.removeAttribute("data-two-capture-role");
    field.value = "";
  }

  beforeEach(() => {
    document.body.innerHTML =
      addressPanel("shipping") + addressPanel("billing");
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
  });

  describe.each([["shipping"], ["billing"]])("the %s panel", (role) => {
    let panels;

    beforeEach(() => {
      panels = {
        shipping: mountPanel("shipping"),
        billing: mountPanel("billing"),
      };
      env
        .identityFor(role)
        .write(
          Object.assign({ companyIdSource: "registry" }, COMPANIES[role]),
          { authoritative: true },
        );
      // The real popover paints the field on a pick; the panel double here
      // records the call instead (its markup is not in this repo), so the
      // painted state is set up the way the popover leaves it.
      nameField(role).value = COMPANIES[role].companyName;
    });

    test.each([
      ["only the field's value", morphFieldValueOnly],
      ["the whole control", morphWholeControl],
    ])("is put back after a re-render rewrites %s", (_what, morph) => {
      morph(role);
      // The premise. Without the blanking there is nothing to put back, and
      // every assertion below would pass on a control nothing had touched.
      expect(nameField(role).value).toBe("");

      env.fireMagewireHook("element.updated", 3);

      expect(nameField(role).value).toBe(COMPANIES[role].companyName);
    });

    test.each([
      ["only the field's value", morphFieldValueOnly],
      ["the whole control", morphWholeControl],
    ])("stays put across several re-renders rewriting %s", (_what, morph) => {
      for (let cycle = 0; cycle < 3; cycle++) {
        morph(role);
        env.fireMagewireHook("element.updated", 3);
        expect(nameField(role).value).toBe(COMPANIES[role].companyName);
      }
    });

    test("leaves the other panel's field empty", () => {
      const other = role === "shipping" ? "billing" : "shipping";
      morphFieldValueOnly(role);

      env.fireMagewireHook("element.updated", 3);

      expect(nameField(other).value).toBe("");
      expect(panels[other].companyName).toBe("");
    });
  });
});
