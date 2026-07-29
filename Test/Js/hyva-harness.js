/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25245. Browser-JS-in-Jest harness for the Hyvä extension.
 *
 * This module's JS is neither AMD nor ESM nor even a `.js` file: it is an
 * inline `<script>` block inside a `.phtml` template, registered with Hyvä's
 * CSP helper and rendered into a page where Alpine, Magewire and Hyvä's own
 * `hyva` global already exist. There is nothing to `require()` — and Jest
 * cannot import a `.phtml` at all.
 *
 * Extracting the JS to a real `.js` file would be the clean answer, but that is
 * a production change, and PR #71 (TWO-25238, the CSP nonce fix) is open over
 * exactly these templates. So the harness does the extraction at TEST time
 * instead: it renders the template the way PHP would (minus PHP), pulls the
 * `<script>` bodies out, and evaluates them in global scope exactly as a
 * `<script>` tag would.
 *
 * No production code was changed to make this testable.
 *
 * The dangerous failure mode for an approach like this is silent degradation:
 * a template edit that the renderer no longer understands, leaving a suite that
 * passes because it is testing nothing. Every step below therefore throws
 * rather than skips — an unknown PHP tag, a leftover PHP tag, a template with
 * no `<script>` in it, and a load that did not produce the globals it should
 * are all hard errors.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/**
 * Test-time stand-ins for the PHP short-echo tags in the templates.
 *
 * Keyed by a pattern matched against the tag's whitespace-collapsed inner
 * expression. Each value is substituted as raw text, so it has to be valid in
 * the JS context the tag sits in. Two tags are used in more than one context
 * and constrain their value:
 *
 *   - the quote JSON appears both bare (`const q = <?= $quoteDetailsJson ?>;`)
 *     and quoted (`quote: '<?= $quoteDetails ?>'`, later `JSON.parse`d), so the
 *     value must be a JSON object literal containing no single quotes;
 *   - `$gwBase` is spliced into identifiers (`<?= $gwBase ?>OnInit()`) as well
 *     as into strings, so it must be a bare identifier fragment.
 *
 * `getAlpineFnPrefix()` returns the brand prefix, so `$gwBase` is
 * `<prefix>GatewayHyva`; the vanilla prefix is `two`.
 */
const QUOTE_JSON =
  '{"quote_id":"test-quote-1","store_id":"1","shipping_country_id":"GB","grand_total":100}';

const PHP_VALUE_RULES = [
  [/^\$gwBase$/, "twoGatewayHyva"],
  [/^\$brandedViewModel->getMethodCode\(\)$/, "two_payment"],
  // Order matters: the str_replace() wrapper has to be matched before the
  // bare getMagewireBlockName() rule below it.
  [/^str_replace\(.*getMagewireBlockName\(\).*\)$/, "two_payment"],
  [
    /^\$brandedViewModel->getMagewireBlockName\(\)$/,
    "checkout.payment.method.two_payment",
  ],
  [/^\$checkoutApiUrl$/, "https://checkout-api.test.invalid"],
  [/^\$companySearchLimit$/, "10"],
  [/^\$isOrderIntentEnabled$/, "1"],
  [/^\$isAddressSearchEnabled$/, "1"],
  [/^\$isCompanySearchEnabled$/, "1"],
  [/^\$currentQuoteId$/, "test-quote-1"],
  [/^\$currentStoreId$/, "1"],
  [/^\$configModel->getIs[A-Za-z]+Enabled\(\)$/, "1"],
  [/^\$merchantId$/, "test-merchant-id"],
  [/^\$merchantName$/, "Example Shop"],
  [/^\$orderIntentConfig\[.*\]$/, "test"],
  [/^\$quoteDetails(Json)?$/, QUOTE_JSON],
  // Bare, not quoted: json_encode() of a string yields a JSON string literal.
  // The optional `?: …` tail is the fallback for json_encode() returning false;
  // TWO-25238 added it so a malformed byte cannot make the template emit nothing
  // where a value belongs.
  [
    /^json_encode\(\s*\$orderIntentApprovedNotice[\s\S]*?\)(?:\s*\?:\s*\S+)?$/,
    '"Approved"',
  ],
  [/^\$escaper->escapeUrl\(.*\)$/, "/checkout"],
];

/**
 * Fallback for an escapeJs() whose argument has no rule of its own — the
 * translated user-facing strings. Its output always lands inside single quotes,
 * so it must contain none.
 */
const ESCAPED_STRING = "Escaped message";

/**
 * Resolve a normalized PHP expression to its test value, or null if no rule
 * applies.
 *
 * escapeJs() is unwrapped rather than matched by a catch-all. TWO-25238 wrapped
 * a set of config values in escapeJs() and a catch-all silently degraded every
 * one of them to the literal `ESCAPED_STRING`, which turned an API base URL into
 * a value `new URL()` rejects and left four other tests exercising a meaningless
 * string while still passing. Unwrapping keeps each value's own rule
 * authoritative no matter how it is escaped at the call site, so adding
 * escaping to a template can never again change what the suite tests.
 *
 * @param {string} expression whitespace-collapsed inner expression
 * @param {Array<[RegExp, string]>} rules
 * @returns {string|null}
 */
function resolveExpression(expression, rules) {
  for (let i = 0; i < rules.length; i += 1) {
    if (rules[i][0].test(expression)) {
      return rules[i][1];
    }
  }

  const escapeJs = /^\$escaper->escapeJs\(\s*([\s\S]*?)\s*\)$/.exec(expression);
  if (escapeJs !== null) {
    // Drop a `(string)` cast the template may apply before escaping.
    const inner = escapeJs[1].replace(/^\(string\)\s*/, "");
    const resolved = resolveExpression(inner, rules);

    return resolved === null ? ESCAPED_STRING : resolved;
  }

  return null;
}

/**
 * Collapse a PHP tag's inner expression to a single line for matching.
 *
 * Strips `/* … *\/` comments (`<?= /* @noEscape *\/ json_encode(…) ?>` is a
 * real tag in gateway_method-csp-js.phtml) and the trailing comma PHP allows
 * before a closing paren.
 *
 * @param {string} raw the text between `<?=` and `?>`
 * @returns {string}
 */
function normalizeExpression(raw) {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ")
    .replace(/,\s*\)/g, ")")
    .trim();
}

/**
 * Render a `.phtml` template's inline JS the way PHP would, minus the PHP.
 *
 * @param {string} relPath repo-relative template path
 * @param {Array<[RegExp, string]>} [extraRules] per-test rules, tried first
 * @returns {string} the concatenated `<script>` bodies
 */
function renderTemplateJs(relPath, extraRules) {
  const absPath = path.join(REPO_ROOT, relPath);
  let source = fs.readFileSync(absPath, "utf8");

  // `<?php … ?>` blocks are the template's PHP preamble and its trailing
  // registerInlineScript() call — they emit nothing, so they are dropped
  // whole rather than substituted.
  source = source.replace(/<\?php[\s\S]*?\?>/g, "");

  const rules = (extraRules || []).concat(PHP_VALUE_RULES);
  source = source.replace(/<\?=([\s\S]*?)\?>/g, function (_match, raw) {
    const expression = normalizeExpression(raw);
    const resolved = resolveExpression(expression, rules);
    if (resolved !== null) {
      return resolved;
    }
    throw new Error(
      "harness: no test value for PHP expression `" +
        expression +
        "` in " +
        relPath +
        ". Add a rule to PHP_VALUE_RULES (or pass one via extraRules) — this throws " +
        "rather than substituting a blank so a template change cannot quietly " +
        "reduce the suite to testing nothing.",
    );
  });

  if (source.indexOf("<?") !== -1) {
    throw new Error("harness: unsubstituted PHP tag left in " + relPath);
  }

  // Attributes are discarded, which is also how a `<script nonce="…">` from
  // the CSP work stays invisible to this harness.
  const blocks = [];
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
  let match = scriptPattern.exec(source);
  while (match !== null) {
    blocks.push(match[1]);
    match = scriptPattern.exec(source);
  }
  if (blocks.length === 0) {
    throw new Error("harness: no <script> block found in " + relPath);
  }
  return blocks.join("\n");
}

/**
 * Evaluate template JS in global scope, exactly as a `<script>` tag would.
 *
 * `indirectEval` keeps evaluation global, so a top-level `function foo() {}`
 * lands on `globalThis` and the file's free references to `hyva`, `Alpine` and
 * `window` resolve to the stubs installed by `installHyvaEnvironment()`.
 *
 * @param {string} relPath repo-relative template path
 * @param {Array<[RegExp, string]>} [extraRules]
 * @returns {void}
 */
function loadTemplate(relPath, extraRules) {
  const indirectEval = eval;
  indirectEval(renderTemplateJs(relPath, extraRules));
}

const GATEWAY_METHOD_TEMPLATE =
  "view/frontend/templates/component/payment/method/gateway_method-csp-js.phtml";
const COMPANY_NAME_TEMPLATE =
  "view/frontend/templates/form/field/companyName-csp-js.phtml";
const SHIPPING_COMPANY_TEMPLATE =
  "view/frontend/templates/component/payment/method/shipping_company.phtml";
const PAYMENT_FIELDS_TEMPLATE =
  "view/frontend/templates/js/payment/company-name-payment.phtml";

/**
 * The globals gateway_method-csp-js.phtml publishes for the other two pickers.
 */
const SHARED_HELPER_GLOBALS = [
  "twoGatewayGetCountryCode",
  "twoGatewayIsDegradedResponse",
  "twoGatewayCompanySearch",
  "twoGatewayCompanyDetail",
  "twoGatewayCompanySearchCache",
  "TWO_GATEWAY_COMPANY_SEARCH_TIMEOUT_MS",
];

/**
 * Load the shared company-search helpers.
 *
 * They live in gateway_method-csp-js.phtml but are hung off `window` precisely
 * so the other two pickers can use them, which is why the whole template is
 * evaluated rather than a hand-copied excerpt.
 *
 * @returns {void}
 */
function loadSharedHelpers() {
  loadTemplate(GATEWAY_METHOD_TEMPLATE);
  SHARED_HELPER_GLOBALS.forEach(function (name) {
    if (window[name] === undefined) {
      throw new Error("harness: " + name + " was not exported onto window");
    }
  });
}

/**
 * Install the globals Hyvä, Alpine and Magewire supply at runtime.
 *
 * Deliberately small: these are third-party globals with no npm distribution
 * available to this repo (Hyvä checkout is a commercial package — the same
 * reason CI stubs it for `setup:di:compile`), so a stub is the only option here.
 * The code under test is ours; only its surroundings are faked.
 *
 * @returns {Object} handles for asserting on what the code under test did
 */
function installHyvaEnvironment() {
  const storage = {};
  const browserStorage = {
    getItem: function (key) {
      return Object.prototype.hasOwnProperty.call(storage, key)
        ? storage[key]
        : null;
    },
    setItem: function (key, value) {
      storage[key] = String(value);
    },
    removeItem: function (key) {
      delete storage[key];
    },
  };

  const hyva = {
    getBrowserStorage: function () {
      return browserStorage;
    },
    formValidation: function () {
      return {
        validate: function () {
          return Promise.resolve(true);
        },
      };
    },
  };

  const alpineComponents = {};
  const alpineStores = {};
  const Alpine = {
    data: function (name, factory) {
      alpineComponents[name] = factory;
    },
    store: function (name, value) {
      if (arguments.length > 1) {
        alpineStores[name] = value;
        return value;
      }
      return alpineStores[name];
    },
  };

  const messages = [];
  const dispatchMessages = function (payload) {
    messages.push(payload);
  };

  // The magewire loader is a boolean overlay, not a counter: the ORDER of
  // these events is the whole subject of shipping-company-loader.test.js, so
  // record them as a sequence rather than as two counts.
  const loaderEvents = [];
  const onLoaderStart = function () {
    loaderEvents.push("start");
  };
  const onLoaderDone = function () {
    loaderEvents.push("done");
  };
  window.addEventListener("magewire:loader:start", onLoaderStart);
  window.addEventListener("magewire:loader:done", onLoaderDone);

  global.hyva = hyva;
  window.hyva = hyva;
  global.Alpine = Alpine;
  window.Alpine = Alpine;
  window.dispatchMessages = dispatchMessages;

  return {
    hyva: hyva,
    storage: storage,
    browserStorage: browserStorage,
    Alpine: Alpine,
    alpineComponents: alpineComponents,
    alpineStores: alpineStores,
    messages: messages,
    loaderEvents: loaderEvents,
    /** Fire the event Alpine fires once it is ready. */
    fireAlpineInit: function () {
      document.dispatchEvent(new Event("alpine:init"));
    },
    /**
     * Undo everything installed here, plus the shared helpers themselves.
     *
     * The helpers are assigned as `window.X = window.X || …`, which is
     * correct in production (three templates each define them and only the
     * first assignment should win) but would carry the FIRST test's copy —
     * and its populated cache — into every later test in the file.
     */
    restore: function () {
      window.removeEventListener("magewire:loader:start", onLoaderStart);
      window.removeEventListener("magewire:loader:done", onLoaderDone);
      delete window.dispatchMessages;
      delete global.hyva;
      delete global.Alpine;
      delete window.hyva;
      delete window.Alpine;
      SHARED_HELPER_GLOBALS.forEach(function (name) {
        delete window[name];
        delete global[name];
      });
    },
  };
}

/**
 * Instantiate an Alpine component factory and attach the magic properties
 * Alpine injects (`$el`, `$root`, `$nextTick`).
 *
 * The components are plain object literals with method shorthand, so calling
 * `component.getItems()` binds `this` the same way Alpine's proxy does.
 *
 * @param {Function} factory the registered Alpine.data factory
 * @param {Object} [options]
 * @param {HTMLElement} [options.el] the bound element (`$el`)
 * @param {HTMLElement} [options.root] the component root (`$root`)
 * @returns {Object} the component
 */
function mountComponent(factory, options) {
  const opts = options || {};
  const component = factory();
  component.$el = opts.el || null;
  component.$root = opts.root || opts.el || null;
  component.$nextTick = function (fn) {
    if (typeof fn === "function") {
      fn();
    }
    return Promise.resolve();
  };
  return component;
}

/**
 * The AbortError a real `fetch` rejects with when its signal aborts.
 *
 * @returns {Error}
 */
function abortError() {
  if (typeof DOMException === "function") {
    return new DOMException("The operation was aborted.", "AbortError");
  }
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

/**
 * Replace `fetch` with a recorder whose calls a test settles by hand.
 *
 * Request timing is the subject matter here — timeouts, supersession, aborts —
 * so driving each response explicitly is the point rather than a shortcut. The
 * abort wiring is load-bearing: the helper distinguishes a timeout from a
 * caller abort by asking the CALLER's signal, and both arrive as an AbortError,
 * so a stub that resolved instead of rejecting would make either look fine.
 *
 * @returns {{calls: Array, last: Function, restore: Function}}
 */
function stubFetch() {
  const original = global.fetch;
  const calls = [];

  global.fetch = function (url, init) {
    const record = {
      url: String(url),
      init: init || {},
      settled: false,
    };
    record.promise = new Promise(function (resolve, reject) {
      record.resolveWith = resolve;
      record.rejectWith = reject;
    });

    /** Resolve as an HTTP response. */
    record.respond = function (body, status) {
      if (record.settled) return;
      record.settled = true;
      const code = status === undefined ? 200 : status;
      record.resolveWith({
        ok: code >= 200 && code < 300,
        status: code,
        json: function () {
          return Promise.resolve(body);
        },
      });
    };
    /** Resolve as a non-2xx with a body that would parse as a payload. */
    record.respondWithStatus = function (status) {
      record.respond({ error: "nope" }, status);
    };
    /** Reject the way a dropped connection does. */
    record.networkError = function () {
      if (record.settled) return;
      record.settled = true;
      record.rejectWith(new TypeError("Failed to fetch"));
    };

    const signal = record.init.signal;
    if (signal) {
      if (signal.aborted) {
        record.settled = true;
        calls.push(record);
        return Promise.reject(abortError());
      }
      signal.addEventListener("abort", function () {
        if (record.settled) return;
        record.settled = true;
        record.rejectWith(abortError());
      });
    }

    calls.push(record);
    return record.promise;
  };

  return {
    calls: calls,
    last: function () {
      return calls[calls.length - 1];
    },
    restore: function () {
      global.fetch = original;
    },
  };
}

/**
 * Drain the microtask queue.
 *
 * Several of the paths under test are two or three `await`s deep behind a
 * `finally`, so a bare `await Promise.resolve()` passes vacuously. Chained
 * microtasks rather than a timer: a real timer would not fire under
 * `jest.useFakeTimers()`, which the timeout tests need.
 *
 * @returns {Promise<void>}
 */
async function flushPromises() {
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve();
  }
}

module.exports = {
  REPO_ROOT: REPO_ROOT,
  QUOTE_JSON: QUOTE_JSON,
  ESCAPED_STRING: ESCAPED_STRING,
  PAYMENT_FIELDS_TEMPLATE: PAYMENT_FIELDS_TEMPLATE,
  GATEWAY_METHOD_TEMPLATE: GATEWAY_METHOD_TEMPLATE,
  COMPANY_NAME_TEMPLATE: COMPANY_NAME_TEMPLATE,
  SHIPPING_COMPANY_TEMPLATE: SHIPPING_COMPANY_TEMPLATE,
  renderTemplateJs: renderTemplateJs,
  loadTemplate: loadTemplate,
  loadSharedHelpers: loadSharedHelpers,
  installHyvaEnvironment: installHyvaEnvironment,
  mountComponent: mountComponent,
  stubFetch: stubFetch,
  flushPromises: flushPromises,
  abortError: abortError,
};
