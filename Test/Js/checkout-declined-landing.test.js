/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-27396. The decline return's `two_declined=1` marker is spent on the
 * landing: the template takes it out of the address bar, keeping every other
 * part of the URL, so a reload or a copied link does not carry it.
 */

"use strict";

const H = require("./hyva-harness");

const TEMPLATE = "view/frontend/templates/checkout/declined-landing.phtml";

function visit(url) {
  window.history.replaceState(null, "", url);
  H.loadTemplate(TEMPLATE, []);
  return window.location.pathname + window.location.search + window.location.hash;
}

describe("Hyvä Checkout decline landing", () => {
  test.each([
    // landing URL, address after, description
    ["/checkout/?two_declined=1#payment", "/checkout/#payment", "the marker alone: query string gone, fragment kept"],
    ["/checkout/?a=1&two_declined=1&b=x%20y", "/checkout/?a=1&b=x%20y", "other parameters survive in order"],
    ["/checkout/?two_declined=0", "/checkout/?two_declined=0", "another value is not the marker"],
    ["/checkout/?xtwo_declined=1", "/checkout/?xtwo_declined=1", "a longer name is not the marker"],
    ["/checkout/?two_express=abc", "/checkout/?two_express=abc", "the express marker is not this one"],
    ["/checkout/", "/checkout/", "no query: unchanged"],
  ])("%s", (landing, expected, description) => {
    expect({ description, address: visit(landing) }).toEqual({ description, address: expected });
  });
});
