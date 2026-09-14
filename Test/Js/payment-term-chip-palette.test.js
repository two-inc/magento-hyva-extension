/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * ABN-593. The chip palette, read through the cascade rather than off the
 * stylesheet's source text: a commented-out rule still contains its own text
 * but no longer paints anything.
 */

const fs = require("fs");
const path = require("path");

const TERM = "two-term-chip";
const TERM_SELECTED = "two-term-chip--selected";
const TERM_SINGLE = "two-term-chip--single";
const MODE = "two-company-mode-chip";
const MODE_SELECTED = "two-company-mode-chip--selected";

// jsdom has no pointer state and never resolves `:focus-visible`, so a class of
// identical specificity stands in for each, leaving the cascade unchanged.
// `:focus` needs no stand-in — a real `.focus()` resolves it.
const HOVER = "two-state-hover";
const FOCUS_VISIBLE = "two-state-focus-visible";

const GREY = "#e3e3e3";
const ACCENT = "#091030";
const WHITE = "#ffffff";

/** @returns {string[]} one selector per comma, commas inside brackets kept */
function splitSelectors(selectorText) {
  const out = [];
  let depth = 0;
  let current = "";
  for (const ch of selectorText) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  // A wrapped selector carries newlines, and padding inside a bracket would
  // unwrap into a descendant combinator.
  return out
    .map((s) =>
      s
        .trim()
        .replace(/\s+/g, " ")
        .replace(/\(\s|\s\)/g, (m) => m.trim()),
    )
    .filter(Boolean);
}

/**
 * nwsapi cannot match `:not()` nested in `:where()`, and `:where(X)` selects
 * exactly what X does — only its specificity differs, and that is scored from
 * the untouched selector.
 *
 * @returns {string} the same selector with every `:where()` wrapper unwrapped
 */
function unwrapWhere(selector) {
  let out = selector;
  for (
    let at = out.indexOf(":where(");
    at !== -1;
    at = out.indexOf(":where(")
  ) {
    const open = at + ":where(".length;
    let depth = 1;
    let close = open;
    while (depth > 0) {
      if (out[close] === "(") depth++;
      else if (out[close] === ")") depth--;
      if (depth > 0) close++;
    }
    out = out.slice(0, at) + out.slice(open, close) + out.slice(close + 1);
  }
  return out;
}

const FUNCTIONAL = /:(not|is|has)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
const WHERE = /:where\([^()]*(?:\([^()]*\)[^()]*)*\)/g;

/** @returns {number[]} [ids, classes, types] per the selectors spec */
function specificity(selector) {
  const score = [0, 0, 0];
  // `:where()` contributes nothing; `:not()`/`:is()`/`:has()` contribute the
  // highest specificity among their arguments.
  let rest = selector.replace(WHERE, " ");
  for (const match of rest.matchAll(FUNCTIONAL)) {
    const best = splitSelectors(match[2])
      .map(specificity)
      .reduce((a, b) => (compare(a, b) >= 0 ? a : b), [0, 0, 0]);
    best.forEach((n, i) => (score[i] += n));
  }
  rest = rest.replace(FUNCTIONAL, " ").replace(/::[\w-]+/g, " ");
  score[0] += (rest.match(/#[\w-]+/g) || []).length;
  score[1] +=
    (rest.match(/\.[\w-]+/g) || []).length +
    (rest.match(/\[[^\]]*\]/g) || []).length +
    (rest.match(/:[\w-]+/g) || []).length;
  score[2] += (rest.match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return score;
}

/** @returns {number} negative when a is weaker than b */
function compare(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

const RULES = [];
let probe;
let applied;

beforeAll(() => {
  const source = fs
    .readFileSync(
      path.join(__dirname, "..", "..", "view/frontend/web/css/custom.css"),
      "utf8",
    )
    .replace(/:hover/g, `.${HOVER}`)
    .replace(/:focus-visible/g, `.${FOCUS_VISIBLE}`);

  const parsed = document.createElement("style");
  parsed.textContent = source;
  document.head.appendChild(parsed);
  Array.from(parsed.sheet.cssRules).forEach((rule, index) => {
    if (!rule.selectorText) {
      return;
    }
    splitSelectors(rule.selectorText)
      // A pseudo-element paints beside the chip box, never it, and nwsapi
      // refuses to compile one.
      .filter((selector) => !selector.includes("::"))
      .forEach((selector) => {
        RULES.push({
          index,
          selector,
          match: unwrapWhere(selector),
          body: rule.style.cssText,
        });
      });
  });
  RULES.forEach((rule) => (rule.score = specificity(rule.selector)));
  parsed.remove();

  applied = document.createElement("style");
  document.head.appendChild(applied);
  probe = document.createElement("button");
  probe.className = "two-probe";
  document.body.appendChild(probe);
});

/**
 * jsdom resolves the cascade by source position alone and mismatches `:where()`
 * while doing it, so `getComputedStyle` on the chip itself reports values no
 * browser paints. `Element.matches()` is accurate, so the winners are chosen
 * here — by specificity, then position — and replayed onto one probe element,
 * where position order is the answer.
 *
 * @returns {Object<string, string>} the properties a chip in this state paints
 */
function styleOf(classes, { disabled = false, focused = false } = {}) {
  const el = document.createElement("button");
  el.className = classes.join(" ");
  el.disabled = disabled;
  document.body.appendChild(el);
  if (focused) {
    el.focus();
  }

  applied.textContent = RULES.filter((rule) => el.matches(rule.match))
    .sort((a, b) => compare(a.score, b.score) || a.index - b.index)
    .map((rule) => `.two-probe { ${rule.body} }`)
    .join("\n");

  const style = getComputedStyle(probe);
  return {
    borderTopWidth: style.borderTopWidth,
    borderLeftWidth: style.borderLeftWidth,
    borderTopColor: style.borderTopColor,
    backgroundColor: style.backgroundColor,
    color: style.color,
    paddingTop: style.paddingTop,
    paddingLeft: style.paddingLeft,
    outline: style.outline,
    opacity: style.opacity,
  };
}

/** @returns {string} `rgb(r, g, b)`, so a hex literal and a computed colour compare */
function rgb(color) {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!hex) {
    return color.trim();
  }
  const n = parseInt(hex[1], 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

describe("the specificity the palette is ordered by", () => {
  it.each([
    { selector: ".two-term-chip", score: [0, 1, 0], case: "a bare class" },
    {
      selector: ".two-term-chip:focus",
      score: [0, 2, 0],
      case: "a class and a pseudo-class",
    },
    {
      selector: ".two-term-chip:focus:where(:not(.a):not(:disabled))",
      score: [0, 2, 0],
      case: "guards inside :where() cost nothing",
    },
    {
      selector: ".a.two-term-chip--single:disabled:hover",
      score: [0, 4, 0],
      case: ":not()-free compounds add up",
    },
    {
      selector: ".two-term-chip--selected:hover:not(:focus)",
      score: [0, 3, 0],
      case: ":not() charges its argument",
    },
    {
      selector: ".two-term-chip[disabled]:not(.two-term-chip--single)",
      score: [0, 3, 0],
      case: "an attribute scores as a class",
    },
  ])("$case", ({ selector, score }) => {
    expect(specificity(selector)).toEqual(score);
  });
});

const RESTING = { width: "2px", border: GREY, background: WHITE, text: ACCENT };
const FILLED = {
  width: "2px",
  border: ACCENT,
  background: ACCENT,
  text: WHITE,
};
const WASHED = { width: "1px", border: ACCENT, background: GREY, text: ACCENT };
const FILLED_WASHED = {
  width: "2px",
  border: ACCENT,
  background: GREY,
  text: WHITE,
};

describe("the unbranded chip palette", () => {
  it.each([
    {
      classes: [TERM],
      ...RESTING,
      case: "a term chip at rest is grey on white",
    },
    {
      classes: [TERM, TERM_SELECTED],
      ...FILLED,
      case: "a selected term chip is a solid accent fill",
    },
    {
      classes: [TERM, HOVER],
      ...WASHED,
      case: "hover thins an unselected term chip's border and washes it grey",
    },
    {
      classes: [TERM],
      focused: true,
      ...WASHED,
      case: "focus washes an unselected term chip exactly as hover does",
    },
    {
      classes: [TERM, HOVER],
      focused: true,
      ...WASHED,
      case: "hovering and focusing an unselected term chip lands on the same wash",
    },
    {
      classes: [TERM, TERM_SELECTED, HOVER],
      ...FILLED,
      case: "hover leaves a selected term chip filled",
    },
    {
      classes: [TERM, TERM_SELECTED],
      focused: true,
      ...FILLED_WASHED,
      case: "focus washes a selected term chip but keeps its 2px edge",
    },
    {
      classes: [TERM, TERM_SELECTED, HOVER],
      focused: true,
      ...FILLED_WASHED,
      case: "focus decides a selected term chip that is hovered too",
    },
    {
      classes: [TERM, TERM_SINGLE],
      ...FILLED,
      case: "a sole offered term reads as a selected chip",
    },
    {
      classes: [TERM, TERM_SINGLE, HOVER],
      disabled: true,
      ...FILLED,
      case: "the disabled sole term chip takes no wash on hover",
    },
    {
      classes: [TERM, HOVER],
      disabled: true,
      ...RESTING,
      case: "a term chip disabled mid-round-trip takes no wash on hover",
    },
    {
      classes: [MODE],
      ...RESTING,
      case: "a mode chip at rest is grey on white",
    },
    {
      classes: [MODE, MODE_SELECTED],
      ...FILLED,
      case: "a selected mode chip is a solid accent fill",
    },
    {
      classes: [MODE, HOVER],
      ...WASHED,
      case: "hover thins an unselected mode chip's border and washes it grey",
    },
    {
      classes: [MODE],
      focused: true,
      ...WASHED,
      case: "focus washes an unselected mode chip exactly as hover does",
    },
    {
      classes: [MODE, HOVER],
      focused: true,
      ...WASHED,
      case: "hovering and focusing an unselected mode chip lands on the same wash",
    },
    {
      classes: [MODE, MODE_SELECTED, HOVER],
      ...FILLED,
      case: "hover leaves a selected mode chip filled",
    },
    {
      classes: [MODE, MODE_SELECTED],
      focused: true,
      ...FILLED_WASHED,
      case: "focus washes a selected mode chip but keeps its 2px edge",
    },
    {
      classes: [MODE, MODE_SELECTED, HOVER],
      focused: true,
      ...FILLED_WASHED,
      case: "focus decides a selected mode chip that is hovered too",
    },
  ])(
    "$case",
    ({ classes, width, border, background, text, disabled, focused }) => {
      const style = styleOf(classes, { disabled, focused });

      expect(style.borderTopWidth).toBe(width);
      expect(rgb(style.borderTopColor)).toBe(rgb(border));
      expect(rgb(style.backgroundColor)).toBe(rgb(background));
      expect(rgb(style.color)).toBe(rgb(text));
    },
  );

  it.each([
    { classes: [TERM], case: "term chip" },
    { classes: [TERM, TERM_SELECTED], case: "selected term chip" },
    { classes: [TERM, TERM_SINGLE], case: "sole offered term chip" },
    { classes: [MODE], case: "mode chip" },
    { classes: [MODE, MODE_SELECTED], case: "selected mode chip" },
  ])("hover and focus do not resize the $case", ({ classes }) => {
    const edges = (state) => {
      const s = styleOf(state.classes, state);
      return [
        parseFloat(s.paddingTop) + parseFloat(s.borderTopWidth),
        parseFloat(s.paddingLeft) + parseFloat(s.borderLeftWidth),
      ];
    };
    const resting = edges({ classes });

    expect(edges({ classes: [...classes, HOVER] })).toEqual(resting);
    expect(edges({ classes, focused: true })).toEqual(resting);
  });

  // Focused for real as well, so an `outline: none` on `:focus` would surface here.
  it.each([
    { base: TERM, case: "term chip" },
    { base: MODE, case: "mode chip" },
  ])(
    "the $case draws its focus ring in the accent (WCAG 2.4.7)",
    ({ base }) => {
      const style = styleOf([base, FOCUS_VISIBLE], { focused: true });

      expect(style.outline).toBe(`2px solid ${ACCENT}`);
    },
  );

  it.each([
    {
      classes: [TERM],
      opacity: "0.7",
      case: "a term chip mid-round-trip is dimmed",
    },
    {
      classes: [TERM, TERM_SINGLE],
      opacity: "1",
      case: "the permanently disabled sole chip is not",
    },
  ])("$case", ({ classes, opacity }) => {
    const style = styleOf(classes, { disabled: true });

    expect(style.opacity || "1").toBe(opacity);
  });
});
