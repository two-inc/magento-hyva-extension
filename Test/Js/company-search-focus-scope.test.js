/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * Bug 4.1 (2026-07-28) — the shipping-address company-search field's focus
 * ring must stay scoped to whichever input actually has DOM focus. Reported
 * live: focusing the search input painted a blue ring around BOTH it and the
 * Company Number field nested below it inside the same `.two-company-search`
 * wrapper, reading as one focused control instead of two independent fields.
 *
 * `.two-company-search` contains the name field and, below it, the captured
 * company number, so a ring painted on the WRAPPER via `:focus-within` — the
 * shared field/input-group behaviour this module used to inherit, meant for an
 * input+addon pair reading as one control — frames both of them the moment the
 * search input gets focus. The fix suppresses that container-level ring and
 * gives the search input its own, scoped by the `>` combinator to exclude
 * anything nested deeper.
 *
 * Two later developments, both 2026-08-05 / TWO-25326, moved where this bug
 * lives and are pinned by the last four tests: §5 replaced the company-number
 * INPUT with a plain-text display, and the tile bugfix batch's bug 3 took
 * `.input-group` off the wrapper altogether — that class's own UNFOCUSED border
 * was the remaining artefact and no `:focus-within` override could reach it.
 *
 * jsdom (the version this repo's Jest runs on) does not implement
 * `:focus-within` matching for `getComputedStyle` — verified empirically, not
 * assumed — so unlike the spinner stylesheet suite this cannot assert
 * through the real cascade. Assertions are therefore at the rule-source
 * level, parsed the same way `company-search-spinner.test.js` parses the
 * spinner rule: comments stripped first, so prose that necessarily names the
 * very selectors under test cannot produce a false positive.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const H = require("./hyva-harness");

const STYLESHEET = "view/frontend/web/css/custom.css";

/** @returns {string} the shipped stylesheet, verbatim */
function stylesheetText() {
  return fs.readFileSync(path.join(H.REPO_ROOT, STYLESHEET), "utf8");
}

/**
 * The stylesheet with its comments stripped, so prose describing these rules
 * cannot itself satisfy a regex written to find them.
 *
 * @returns {string}
 */
function declarations() {
  return stylesheetText().replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * A rule's declaration block, by selector, or `null` if the stylesheet does
 * not carry it at all — the failure mode a straight revert of the fix
 * produces.
 *
 * @param {string} selector a literal selector, regex-escaped internally
 * @returns {string|null}
 */
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
  const match = declarations().match(
    new RegExp(escaped + "\\s*\\{([\\s\\S]*?)\\}"),
  );
  return match === null ? null : match[1];
}

describe("company-search focus scope (bug 4.1)", () => {
  test("the wrapper's own focus-within ring is suppressed", () => {
    // Without this rule the reported bleed is exactly what the shared
    // field/input-group `:focus-within` behaviour produces: a ring framing
    // the whole wrapper, Company Number field included.
    const body = ruleBody(".two-company-search:focus-within");

    if (body === null) {
      throw new Error(
        "no `.two-company-search:focus-within` rule in " +
          STYLESHEET +
          " — the container-level ring this bug reported is unsuppressed.",
      );
    }
    expect(body).toMatch(/box-shadow:\s*none/);
    expect(body).toMatch(/outline:\s*none/);
  });

  test("the search input carries its own scoped focus ring", () => {
    // `>` rather than a descendant combinator is load-bearing: the Company
    // Number input sits one level further inside `.two-company-search`
    // (nested under `.two-company-id`), so a bare descendant selector here
    // would re-introduce a ring on BOTH inputs — the exact bug, moved down
    // one level rather than fixed.
    const body = ruleBody(".two-company-search > input:focus");

    if (body === null) {
      throw new Error(
        "no `.two-company-search > input:focus` rule in " +
          STYLESHEET +
          " — suppressing the wrapper's ring with nothing scoped to the " +
          "input itself would leave the search field with no visible focus " +
          "affordance at all.",
      );
    }
    expect(body).toMatch(/box-shadow:\s*(?!none)\S/);

    // The colour must be Tailwind's actual `indigo-300` (`#A5B4FC` ==
    // `rgb(165, 180, 252)`) — the same token gateway_method.phtml's input
    // carries via `focus:ring-indigo-300` — not `indigo-400`
    // (`rgb(129, 140, 248)`), which a prior revision of this rule used by
    // mistake. Asserting the exact channel values, not just "some colour",
    // is what catches that one-shade drift.
    expect(body).toMatch(/rgba?\(\s*165,\s*180,\s*252/);
    expect(body).not.toMatch(/129,\s*140,\s*248/);
  });

  test("there is no company-number INPUT on the address step at all (TWO-25326 §5)", () => {
    // Stronger than the claim this replaces. The number used to be a real,
    // permanently-visible input and the rule above only had to avoid ringing
    // it; §5 removes it outright, so the guarantee is now that no such control
    // exists — not before a selection, not in manual mode, not ever.
    const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
    const doc = new DOMParser().parseFromString(markup, "text/html");

    expect(doc.querySelector(".two-company-search")).not.toBeNull();
    expect(doc.querySelector("input[data-two-company-id]")).toBeNull();
    expect(doc.querySelector("input.company_id")).toBeNull();
    expect(doc.querySelector("#two_address_company_id")).toBeNull();

    // What replaces it: a plain-text display, gated on a registry-supplied
    // number, carrying no form control of any kind.
    const display = doc.querySelector(".two-company-id-display");
    expect(display).not.toBeNull();
    expect(display.tagName).toBe("DIV");
    expect(display.getAttribute("x-show")).toBe("companyIdDisplayVisible");
    expect(display.querySelector("input")).toBeNull();
  });

  test("the grandparent ring is suppressed on this module's OWN hook, not on input-group (TWO-25326 tile bugfix bug 3)", () => {
    // REWRITTEN 2026-08-05 (TWO-25326 tile bugfix batch, bug 3). This test used
    // to demand a `.input-group.two-company-search-group:focus-within` rule,
    // because the control's wrapper carried Hyvä's `.input-group` class and that
    // class's `:focus-within` ring framed the name field and the number display
    // together.
    //
    // Suppressing the RING was never the whole bug. `.input-group` also paints a
    // faint, PERMANENT container border when nothing is focused at all, and that
    // unfocused border is what was actually reported. A CSS override cannot reach
    // it, so the class is gone from the wrapper entirely
    // (form/field/company-search-control.phtml) — the control is a name input, a
    // results panel and a number display, three separately labelled things, not
    // an input-plus-addon pair, so it was never an input-group to begin with.
    //
    // The suppression itself is KEPT, re-scoped to the hook this module puts on
    // the element itself, so a merchant theme or branded overlay that rings a
    // container on `:focus-within` by some other selector still cannot frame the
    // two fields as one control.
    const body = ruleBody(
      ".two-company-search-group.two-company-search-group:focus-within",
    );

    if (body === null) {
      throw new Error(
        "no `.two-company-search-group.two-company-search-group:focus-within` " +
          "rule in " +
          STYLESHEET +
          " — without it any theme that rings a container on :focus-within " +
          "keeps painting a ring around both the company-name field and the " +
          "number display.",
      );
    }
    expect(body).toMatch(/box-shadow:\s*none/);
    expect(body).toMatch(/outline:\s*none/);
    // And deliberately NOT `border-color`. Measured on the live checkout, the
    // theme's own rule does change `border-color` on focus but `border-width`
    // computes to 0px in both states, so it paints nothing; the visible blue is
    // the Tailwind ring, i.e. the box-shadow. Forcing the colour transparent
    // would only risk erasing a real border a merchant theme does draw.
    expect(body).not.toMatch(/border-color/);
  });

  /*
   * DELETED 2026-08-05, not rewritten:
   *
   *  - "the focus ring is suppressed on the GRANDPARENT input-group too" — the
   *    selector it named no longer ships. Its declaration-level half survives as
   *    the test above; its structural half (that `.input-group` is not emitted at
   *    all) is covered, for BOTH mount points rather than just this one, by
   *    `company-search-one-control.test.js` → "the control is not an input-group
   *    (bug 3)" → "no mount point emits the class".
   *  - "the grandparent rule outranks the theme rule on specificity alone" — the
   *    specificity claim moved with the selector, and the same suite's "the
   *    focus-ring suppression matches the hook the control does emit" pins both
   *    the doubled selector and the absence of the dead `.input-group` form.
   *
   * Both are gone from here rather than duplicated: a second copy of a structural
   * guarantee in a suite scoped to one surface is how the two surfaces drifted
   * apart in the first place.
   */

  test("the hook the grandparent rule needs is actually on the shipped element", () => {
    // A CSS rule scoped to a class no element carries is a fix that never
    // applies — the exact shape of the Luma `!important` defect on this ticket,
    // where a hide rule sat in the tree for weeks and never once matched.
    const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
    const doc = new DOMParser().parseFromString(markup, "text/html");

    const group = doc.querySelector(".two-company-search-group");
    expect(group).not.toBeNull();
    // It must really be the grandparent of the company-name input, or it is
    // not the element the ring is painted on.
    const input = doc.querySelector(".two-company-search > input");
    expect(input).not.toBeNull();
    expect(input.parentElement.parentElement).toBe(group);
  });
});
