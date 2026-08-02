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
 * `.two-company-search` contains both inputs (the search field directly, the
 * Company Number field one level further in, inside `.two-company-id`), so a
 * ring painted on the WRAPPER via `:focus-within` — the shared field/
 * input-group behaviour this module inherits, meant for an input+addon pair
 * reading as one control — frames both of them the moment the search input
 * gets focus. The fix suppresses that container-level ring and gives the
 * search input its own, scoped by the `>` combinator to exclude the nested
 * Company Number input.
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

  test("the focus ring is suppressed on the GRANDPARENT input-group too (TWO-25326 §7)", () => {
    // The reported 6px blue border was painted one level further out than the
    // rule this file already covered: Hyva's shared field styling rings an
    // `.input-group` on `:focus-within`, and that element is the GRANDPARENT
    // of the company-name input, so focusing the input framed the whole group.
    // Suppressing it on `.two-company-search` alone never touched that.
    const body = ruleBody(".input-group.two-company-search-group:focus-within");

    if (body === null) {
      throw new Error(
        "no `.input-group.two-company-search-group:focus-within` rule in " +
          STYLESHEET +
          " — without it the input-group grandparent keeps painting a ring " +
          "around both the company-name field and the number display.",
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

  test("the grandparent rule outranks the theme rule on specificity alone", () => {
    // The theme ships `.input-group:focus-within` at (0,2,0). A selector of
    // `.two-company-search-group:focus-within` ties it, and a tie is settled by
    // stylesheet load order — which this module does not control. Doubling
    // `.input-group` into the selector makes it (0,3,0) and removes load order
    // from the question entirely.
    //
    // This is the defect shape the Luma leg of this ticket hit: a hide rule
    // that lost on specificity, sat in the tree for weeks, and never applied.
    const css = declarations();
    expect(css).toMatch(
      /\.input-group\.two-company-search-group:focus-within\s*\{/,
    );
    // And the bare, tie-ing form must NOT be what ships.
    expect(css).not.toMatch(/(^|[^.\w-])\.two-company-search-group:focus-within/m);
  });

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
