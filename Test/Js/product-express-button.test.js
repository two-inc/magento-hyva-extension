/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-26616. The product page "Buy with <brand>" button on a Hyvä theme.
 *
 * On Luma the base module's button submits the product's own add-to-cart form
 * with a `return_url` carrying a per-attempt token, so core's controller sends
 * the buyer to the base module's confirmation (and on to checkout) only when
 * the add succeeded. On Hyvä there is no RequireJS, so the base template's
 * button did nothing at all. These cases pin the Hyvä template's half of that
 * flow: which form it submits, what it puts on it, when it refuses to submit,
 * and what it puts back.
 *
 * The brand and its words come from the base module's block, so every value
 * here is a deliberately non-default brand: a template that hard-coded a name
 * would render it instead of these.
 */

"use strict";

const H = require("./hyva-harness");

const TEMPLATE = "view/frontend/templates/product/express-button.phtml";
const RETURN_URL = "https://shop.test/two/express/confirm/?product=42";

const BLOCK_RULES = [
  [/^\$block->getBrandCode\(\)$/, "examplebrand"],
  [/^\$block->getReturnUrl\(\)$/, RETURN_URL],
  [/^\$block->getLabel\(\)$/, "Buy with"],
  [/^\$block->getBrandLabel\(\)$/, "Example Brand"],
];

/** A Hyvä-shaped product form: options and qty inside, the button outside. */
function productForm(options) {
  const opts = options || {};
  return (
    '<form id="product_addtocart_form" method="post" action="https://shop.test/checkout/cart/add/">' +
    '<input type="hidden" name="product" value="42" />' +
    '<input type="hidden" name="form_key" value="fk" />' +
    (opts.returnUrl
      ? '<input type="hidden" name="return_url" value="' + opts.returnUrl + '" />'
      : "") +
    '<select name="super_attribute[93]"' +
    (opts.required ? " required" : "") +
    '><option value="">Choose</option><option value="7"' +
    (opts.chosen === false ? "" : " selected") +
    ">Red</option></select>" +
    '<input type="number" name="qty" value="3" />' +
    (opts.submitField ? '<input type="hidden" name="submit" value="x" />' : "") +
    "</form>"
  );
}

function mount(formHtml) {
  document.body.innerHTML =
    formHtml + H.renderTemplateMarkup(TEMPLATE, BLOCK_RULES);
  H.loadTemplate(TEMPLATE, BLOCK_RULES);
  return document.querySelector(".two-product-express__button");
}

function persistedPageshow() {
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  window.dispatchEvent(event);
}

describe("Hyvä product page express button", () => {
  let submitted;

  beforeEach(() => {
    submitted = [];
    jest
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(function () {
        submitted.push({ form: this, data: new FormData(this) });
      });
  });

  test("renders the base block's label, brand name and brand code, and no mage-init", () => {
    const button = mount(productForm());

    expect(button.type).toBe("button");
    expect(button.textContent.replace(/\s+/g, " ").trim()).toBe(
      "Buy with Example Brand",
    );
    expect(button.closest(".two-product-express").dataset.brand).toBe(
      "examplebrand",
    );
    expect(button.hasAttribute("data-mage-init")).toBe(false);
    expect(
      button.querySelector(".two-product-express__mark").getAttribute("aria-hidden"),
    ).toBe("true");
  });

  test("a click submits the product form with its options, qty and a tokened return_url", () => {
    const button = mount(productForm());

    button.click();

    expect(submitted).toHaveLength(1);
    const { form, data } = submitted[0];
    expect(form.id).toBe("product_addtocart_form");
    expect(data.get("qty")).toBe("3");
    expect(data.get("super_attribute[93]")).toBe("7");
    expect(data.get("product")).toBe("42");
    const returnUrl = data.get("return_url");
    expect(returnUrl.startsWith(RETURN_URL + "&t=")).toBe(true);
    expect(returnUrl.slice((RETURN_URL + "&t=").length)).toMatch(/^[a-z0-9]+$/);
    expect(button.disabled).toBe(true);
  });

  test("a return URL with no query string gets the token as its first parameter", () => {
    const rules = [[/^\$block->getReturnUrl\(\)$/, "https://shop.test/confirm/"]].concat(
      BLOCK_RULES,
    );
    document.body.innerHTML =
      productForm() + H.renderTemplateMarkup(TEMPLATE, rules);
    H.loadTemplate(TEMPLATE, rules);

    document.querySelector(".two-product-express__button").click();

    expect(submitted[0].data.get("return_url")).toMatch(
      /^https:\/\/shop\.test\/confirm\/\?t=[a-z0-9]+$/,
    );
  });

  test("each attempt carries its own token", () => {
    const first = mount(productForm());
    first.click();
    const second = mount(productForm());
    second.click();

    expect(submitted).toHaveLength(2);
    expect(submitted[0].data.get("return_url")).not.toBe(
      submitted[1].data.get("return_url"),
    );
  });

  test("a double click is one add, not two", () => {
    const button = mount(productForm());

    button.click();
    button.disabled = false; // a click that lands before the disable paints
    button.click();

    expect(submitted).toHaveLength(1);
  });

  test("an unchosen required option is reported and nothing is submitted", () => {
    const button = mount(productForm({ required: true, chosen: false }));
    const form = document.getElementById("product_addtocart_form");
    const report = jest.spyOn(form, "reportValidity");

    button.click();

    expect(submitted).toHaveLength(0);
    expect(report).toHaveBeenCalledTimes(1);
    expect(form.querySelector('input[name="return_url"]')).toBeNull();
    expect(button.disabled).toBe(false);
  });

  test("a button inside a form submits that form, not the page's product form", () => {
    document.body.innerHTML =
      productForm() +
      '<form id="other" action="https://shop.test/checkout/cart/add/">' +
      '<input type="number" name="qty" value="1" />' +
      H.renderTemplateMarkup(TEMPLATE, BLOCK_RULES) +
      "</form>";
    H.loadTemplate(TEMPLATE, BLOCK_RULES);

    document.querySelector(".two-product-express__button").click();

    expect(submitted).toHaveLength(1);
    expect(submitted[0].form.id).toBe("other");
  });

  test("a form with a field named submit is still submitted", () => {
    const button = mount(productForm({ submitField: true }));

    button.click();

    expect(submitted).toHaveLength(1);
  });

  test("no product form on the page: the click does nothing", () => {
    const button = mount("");

    button.click();

    expect(submitted).toHaveLength(0);
    expect(button.disabled).toBe(false);
  });

  test("a back-forward cache restore removes the return_url this created", () => {
    const button = mount(productForm());
    const form = document.getElementById("product_addtocart_form");
    button.click();

    persistedPageshow();

    expect(form.querySelector('input[name="return_url"]')).toBeNull();
    expect(button.disabled).toBe(false);
    button.click();
    expect(submitted).toHaveLength(2);
  });

  test("a back-forward cache restore puts back a return_url the theme set", () => {
    const button = mount(productForm({ returnUrl: "https://shop.test/theirs" }));
    const form = document.getElementById("product_addtocart_form");
    button.click();
    expect(submitted[0].data.get("return_url")).toContain("&t=");

    persistedPageshow();

    const fields = form.querySelectorAll('input[name="return_url"]');
    expect(fields).toHaveLength(1);
    expect(fields[0].value).toBe("https://shop.test/theirs");
  });

  test("an ordinary pageshow undoes nothing", () => {
    const button = mount(productForm());
    button.click();

    window.dispatchEvent(new Event("pageshow"));

    expect(button.disabled).toBe(true);
    expect(
      document.querySelector('#product_addtocart_form input[name="return_url"]'),
    ).not.toBeNull();
  });

  test("the script running twice binds the button once", () => {
    const button = mount(productForm());
    H.loadTemplate(TEMPLATE, BLOCK_RULES);

    button.click();

    expect(submitted).toHaveLength(1);
    expect(
      document.querySelectorAll('#product_addtocart_form input[name="return_url"]'),
    ).toHaveLength(1);
  });
});
