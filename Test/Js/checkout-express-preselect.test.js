/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-26616. Hyvä Checkout's half of the product page "Buy with <brand>" flow:
 * a buyer who lands on checkout carrying the base module's `two_express`
 * marker gets this brand's method preselected, once, and only as a default.
 *
 * The method code comes from the branded view model, so these cases render a
 * non-default brand's code and keep a `two_payment` radio on the page: a
 * template that hard-coded the default would select that one instead.
 */

"use strict";

const H = require("./hyva-harness");

const TEMPLATE = "view/frontend/templates/checkout/express-preselect.phtml";
const BRAND_METHOD = "examplebrand_payment";
const RULES = [[/^\$methodCode$/, BRAND_METHOD]];

function paymentList(options) {
  const opts = options || {};
  const radio = (value, extra) =>
    '<input type="radio" name="payment-method-option" value="' +
    value +
    '"' +
    (extra || "") +
    " />";
  return (
    '<div id="payment-methods">' +
    radio("checkmo", opts.checked === "checkmo" ? " checked" : "") +
    radio("two_payment") +
    (opts.offered === false
      ? ""
      : radio(
          BRAND_METHOD,
          (opts.checked === BRAND_METHOD ? " checked" : "") +
            (opts.disabled ? " disabled" : ""),
        )) +
    "</div>"
  );
}

function installMagewire() {
  const hooks = {};
  window.Magewire = {
    hook(name, callback) {
      (hooks[name] = hooks[name] || []).push(callback);
    },
  };
  return {
    roundTrip() {
      (hooks["message.processed"] || []).forEach((callback) => callback());
    },
    hookCount(name) {
      return (hooks[name] || []).length;
    },
  };
}

function radio(value) {
  return document.querySelector(
    'input[name="payment-method-option"][value="' + value + '"]',
  );
}

function visit(url) {
  window.history.replaceState(null, "", url);
  H.loadTemplate(TEMPLATE, RULES);
}

describe("Hyvä Checkout express preselect", () => {
  let magewire;
  let clicks;
  let recordClick;

  beforeEach(() => {
    window.sessionStorage.clear();
    magewire = installMagewire();
    document.body.innerHTML = paymentList({ checked: "checkmo" });
    clicks = [];
    recordClick = (event) => clicks.push(event.target.value);
    document.addEventListener("click", recordClick);
  });

  afterEach(() => {
    document.removeEventListener("click", recordClick);
    delete window.Magewire;
  });

  test("a marked arrival selects the brand's method by clicking its radio", () => {
    visit("/checkout/?two_express=abc123");

    expect(radio(BRAND_METHOD).checked).toBe(true);
    expect(radio("two_payment").checked).toBe(false);
    expect(clicks).toEqual([BRAND_METHOD]);
  });

  test("the marker is stripped from the URL, keeping every other part of it", () => {
    visit("/checkout/?step=payment&two_express=abc123&x=a%20b#totals");

    expect(window.location.pathname).toBe("/checkout/");
    expect(window.location.search).toBe("?step=payment&x=a%20b");
    expect(window.location.hash).toBe("#totals");
  });

  test("a URL whose only parameter is the marker loses its query string", () => {
    visit("/checkout/?two_express=abc123");

    expect(window.location.search).toBe("");
  });

  test("no marker: nothing is selected and nothing is hooked", () => {
    visit("/checkout/?step=payment");

    expect(radio("checkmo").checked).toBe(true);
    expect(clicks).toEqual([]);
    expect(magewire.hookCount("message.processed")).toBe(0);
  });

  test("a marker this tab already consumed selects nothing, and is still stripped", () => {
    visit("/checkout/?two_express=abc123");
    document.body.innerHTML = paymentList({ checked: "checkmo" });
    clicks.length = 0;

    visit("/checkout/?two_express=abc123");

    expect(radio("checkmo").checked).toBe(true);
    expect(clicks).toEqual([]);
    expect(window.location.search).toBe("");
  });

  test("a new attempt's token is a new intent, not a replay", () => {
    visit("/checkout/?two_express=first");
    document.body.innerHTML = paymentList({ checked: "checkmo" });
    clicks.length = 0;

    visit("/checkout/?two_express=second");

    expect(clicks).toEqual([BRAND_METHOD]);
  });

  test("a marker that is not a token is ignored", () => {
    visit("/checkout/?two_express=%3Cx%3E");

    expect(clicks).toEqual([]);
    expect(window.location.search).toBe("");
  });

  test("a method not offered yet is selected when a round trip brings it", () => {
    document.body.innerHTML = paymentList({ checked: "checkmo", offered: false });
    visit("/checkout/?two_express=abc123");
    expect(clicks).toEqual([]);

    document.body.innerHTML = paymentList({ checked: "checkmo" });
    magewire.roundTrip();

    expect(radio(BRAND_METHOD).checked).toBe(true);
    expect(clicks).toEqual([BRAND_METHOD]);
  });

  test("a later step's payment list is selected when it renders", () => {
    document.body.innerHTML = '<div id="shipping-step"></div>';
    visit("/checkout/?two_express=abc123");

    document.body.innerHTML = paymentList();
    magewire.roundTrip();

    expect(clicks).toEqual([BRAND_METHOD]);
  });

  test("the buyer choosing first wins, even once the method appears", () => {
    document.body.innerHTML = paymentList({ offered: false });
    visit("/checkout/?two_express=abc123");

    radio("checkmo").click();
    clicks.length = 0;
    document.body.innerHTML = paymentList({ checked: "checkmo" });
    magewire.roundTrip();

    expect(radio("checkmo").checked).toBe(true);
    expect(clicks).toEqual([]);
  });

  test("selected once only: a later round trip does not override the buyer", () => {
    visit("/checkout/?two_express=abc123");
    radio("checkmo").click();
    clicks.length = 0;

    magewire.roundTrip();

    expect(radio("checkmo").checked).toBe(true);
    expect(clicks).toEqual([]);
  });

  test("a method already selected is not clicked again", () => {
    document.body.innerHTML = paymentList({ checked: BRAND_METHOD });

    visit("/checkout/?two_express=abc123");

    expect(clicks).toEqual([]);
  });

  test("a disabled radio is waited for, and selected once a round trip enables it", () => {
    document.body.innerHTML = paymentList({ checked: "checkmo", disabled: true });

    visit("/checkout/?two_express=abc123");
    expect(radio("checkmo").checked).toBe(true);

    document.body.innerHTML = paymentList({ checked: "checkmo" });
    magewire.roundTrip();

    expect(radio(BRAND_METHOD).checked).toBe(true);
  });

  test("without Magewire nothing is clicked, since nothing would be saved", () => {
    delete window.Magewire;

    visit("/checkout/?two_express=abc123");

    expect(radio("checkmo").checked).toBe(true);
    expect(clicks).toEqual([]);
  });
});
