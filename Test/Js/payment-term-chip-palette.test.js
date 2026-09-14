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
 * nwsapi answers `.c:where(:not(.d))` false for `<button class="c">`, which is
 * wrong, so the guard is unwrapped before matching: `:where(X)` selects exactly
 * what X does, and its specificity is scored from the untouched selector.
 * Unwrapping a selector list would splice a comma into the middle of a
 * compound, so that shape is refused rather than mangled.
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
    const inner = out.slice(open, close);
    if (splitSelectors(inner).length > 1) {
      throw new Error(`:where() carries a selector list: ${selector}`);
    }
    out = out.slice(0, at) + inner + out.slice(close + 1);
  }
  return out;
}

const FUNCTIONAL = /:(not|is|has)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
const WHERE = /:where\([^()]*(?:\([^()]*\)[^()]*)*\)/g;

/** @returns {number[]} [ids, classes, types] per the selectors spec */
function specificity(selector) {
  // A pseudo-element scores in a column this does not track, so it is refused
  // rather than guessed at. An attribute is emptied instead: whatever its value
  // held, including a space that would otherwise read as a type selector, the
  // whole of it scores as one class.
  if (selector.includes("::")) {
    throw new Error(`specificity() cannot score: ${selector}`);
  }
  const score = [0, 0, 0];
  selector = selector.replace(/\[[^\]]*\]/g, "[]");
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
    (rest.match(/\[\]/g) || []).length +
    (rest.match(/:[\w-]+/g) || []).length;
  score[2] += (rest.match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return score;
}

/** @returns {number} negative when a is weaker than b */
function compare(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

const FAMILIES = [
  /\.two-term-chip(?:--[\w-]+)?(?![\w-])/g,
  /\.two-company-mode-chip(?:--[\w-]+)?(?![\w-])/g,
];
const MODIFIER = /--(selected|single)(?![\w-])/;
const GUARD = /:(where|not|is|has)\([^()]*(?:\([^()]*\)[^()]*)*\)/g;

/**
 * An attribute value can hold a space, which would then read as a descendant
 * combinator, so it is emptied first. Guards come out entirely rather than
 * becoming a space, which would split one compound into two.
 *
 * @returns {string} the selector with its attribute values and guards blanked
 */
function bareOf(selector) {
  return selector
    .replace(/\[[^\]]*\]/g, "[]")
    .replace(GUARD, "")
    .trim();
}

/** @returns {string} the compound the selector actually paints */
function subjectOf(selector) {
  return bareOf(selector)
    .split(/[\s>+~]+/)
    .pop();
}

/** @returns {number} chip classes the compound names */
function names(compound) {
  return Math.max(
    ...FAMILIES.map((family) => (compound.match(family) || []).length),
  );
}

/** @returns {boolean} whether the rule paints a chip's own box */
function aimsAtAChip(selector) {
  return names(subjectOf(selector)) > 0;
}

const STYLE_RULE = 1;
const KEYFRAMES_RULE = 7;
const GROUPING_RULES = [4, 12]; // @media, @supports

/**
 * A rule nested in an at-rule paints exactly as one at the top level does, so
 * skipping the wrapper would let a repaint through unseen. Anything this model
 * has no reading for stops the suite rather than being dropped.
 *
 * @returns {CSSStyleRule[]} every style rule, in document order
 */
function styleRules(rules, into = []) {
  Array.from(rules).forEach((rule) => {
    if (rule.type === STYLE_RULE) {
      into.push(rule);
    } else if (GROUPING_RULES.includes(rule.type)) {
      styleRules(rule.cssRules, into);
    } else if (rule.type !== KEYFRAMES_RULE) {
      throw new Error(`unreadable at-rule: ${rule.cssText.slice(0, 60)}`);
    }
  });
  return into;
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
  styleRules(parsed.sheet.cssRules).forEach((rule, index) => {
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
          declarations: Array.from(rule.style).map((property) => [
            property,
            rule.style.getPropertyValue(property),
          ]),
        });
      });
  });
  parsed.remove();

  /*
   * Scored here, not when a rule first reaches a chip: a rule keyed on an
   * attribute no modelled element carries would otherwise never be scored and
   * so never refused. Rules that aim at no chip are left alone — the sheet also
   * holds shapes `specificity()` will not score, and none of them paints a chip.
   */
  RULES.filter((rule) => aimsAtAChip(rule.selector)).forEach(scoreOf);

  applied = document.createElement("style");
  document.head.appendChild(applied);
  probe = document.createElement("button");
  probe.className = "two-probe";
  document.body.appendChild(probe);
});

/**
 * Every rule aimed at a chip is scored up front, so an unscoreable one is
 * refused whether or not a modelled state happens to match it. A rule aimed
 * elsewhere is scored here, when it turns out to reach a chip after all — being
 * unscored must never quietly mean being left out of the cascade.
 *
 * @returns {number[]} the selector's specificity
 */
function scoreOf(rule) {
  if (!rule.score) {
    rule.score = specificity(rule.selector);
  }
  return rule.score;
}

/**
 * jsdom resolves the cascade by source position alone, so `getComputedStyle` on
 * the chip itself reports values no browser paints. The winners are chosen here
 * instead — by specificity, then position — and replayed onto one probe
 * element, where position order is the answer.
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
    .sort((a, b) => compare(scoreOf(a), scoreOf(b)) || a.index - b.index)
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
    {
      selector: "button.two-term-chip",
      score: [0, 1, 1],
      case: "a type selector scores in its own column",
    },
    {
      selector: "body button.two-term-chip",
      score: [0, 1, 2],
      case: "a descendant type selector scores again",
    },
    {
      selector: "#checkout .two-term-chip",
      score: [1, 1, 0],
      case: "an id outranks every class",
    },
    {
      selector: '.two-term-chip[data-single="1"]',
      score: [0, 2, 0],
      case: "an attribute value scores as one class",
    },
    {
      selector: '.two-term-chip[data-name="a b"]',
      score: [0, 2, 0],
      case: "a space inside an attribute value is not a type selector",
    },
  ])("$case", ({ selector, score }) => {
    expect(specificity(selector)).toEqual(score);
  });

  it("refuses to score a pseudo-element", () => {
    expect(() => specificity(".two-term-chip::before")).toThrow(/cannot score/);
  });

  it("refuses to unwrap a :where() selector list", () => {
    expect(() => unwrapWhere(".a:where(.x, .y)")).toThrow(/selector list/);
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
      ...FILLED,
      case: "focus leaves a selected term chip filled",
    },
    {
      classes: [TERM, TERM_SELECTED, HOVER],
      focused: true,
      ...FILLED,
      case: "hover and focus together leave a selected term chip filled",
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
      ...FILLED,
      case: "focus leaves a selected mode chip filled",
    },
    {
      classes: [MODE, MODE_SELECTED, HOVER],
      focused: true,
      ...FILLED,
      case: "hover and focus together leave a selected mode chip filled",
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

/*
 * jsdom cascades by source position and ignores specificity, so no computed
 * style can show which rule a browser would pick. This walks the matches
 * instead: for every property a chip state contests, the strongest selector
 * that declares it has to agree with every other selector of that strength.
 */
describe("no chip state is settled by source order", () => {
  it.each([
    { classes: [TERM], case: "a term chip at rest" },
    { classes: [TERM, HOVER], case: "a hovered term chip" },
    { classes: [TERM], focused: true, case: "a focused term chip" },
    {
      classes: [TERM, HOVER],
      focused: true,
      case: "a hovered, focused term chip",
    },
    {
      classes: [TERM, FOCUS_VISIBLE],
      focused: true,
      case: "a keyboard-focused term chip",
    },
    { classes: [TERM], disabled: true, case: "a busy term chip" },
    {
      classes: [TERM, HOVER],
      disabled: true,
      case: "a hovered busy term chip",
    },
    { classes: [TERM, TERM_SELECTED], case: "a selected term chip" },
    {
      classes: [TERM, TERM_SELECTED, HOVER],
      case: "a hovered selected term chip",
    },
    {
      classes: [TERM, TERM_SELECTED],
      focused: true,
      case: "a focused selected term chip",
    },
    {
      classes: [TERM, TERM_SINGLE],
      disabled: true,
      case: "the sole offered term",
    },
    {
      classes: [TERM, TERM_SINGLE, HOVER],
      disabled: true,
      case: "the hovered sole offered term",
    },
    { classes: [MODE], case: "a mode chip at rest" },
    { classes: [MODE, HOVER], case: "a hovered mode chip" },
    { classes: [MODE], focused: true, case: "a focused mode chip" },
    {
      classes: [MODE, HOVER],
      focused: true,
      case: "a hovered, focused mode chip",
    },
    {
      classes: [MODE, FOCUS_VISIBLE],
      focused: true,
      case: "a keyboard-focused mode chip",
    },
    { classes: [MODE, MODE_SELECTED], case: "a selected mode chip" },
    {
      classes: [MODE, MODE_SELECTED, HOVER],
      case: "a hovered selected mode chip",
    },
    {
      classes: [MODE, MODE_SELECTED],
      focused: true,
      case: "a focused selected mode chip",
    },
  ])(
    "$case has one strongest rule per property",
    ({ classes, disabled, focused }) => {
      const el = document.createElement("button");
      el.className = classes.join(" ");
      el.disabled = !!disabled;
      document.body.appendChild(el);
      if (focused) {
        el.focus();
      }

      const strongest = new Map();
      RULES.filter((rule) => el.matches(rule.match)).forEach((rule) => {
        rule.declarations.forEach(([property, value]) => {
          const held = strongest.get(property);
          if (!held || compare(scoreOf(rule), held.score) > 0) {
            strongest.set(property, {
              score: scoreOf(rule),
              values: new Set([value]),
            });
          } else if (compare(scoreOf(rule), held.score) === 0) {
            held.values.add(value);
          }
        });
      });

      const ties = [...strongest]
        .filter(([, held]) => held.values.size > 1)
        .map(
          ([property, held]) => `${property}: ${[...held.values].join(" vs ")}`,
        );

      expect(ties).toEqual([]);
    },
  );
});

/*
 * The base plugin's stylesheet declares the very same chips one class deep, and
 * loads first. A rule here that dropped back to that weight would look identical
 * in this file and lose outright on the page, so the weight is asserted.
 */
describe("the palette outweighs the base plugin's own chip rules", () => {
  it("every chip selector names its class often enough to outweigh one", () => {
    const underweight = RULES.filter((rule) => aimsAtAChip(rule.selector))
      .filter((rule) => {
        const subject = subjectOf(rule.selector);
        return names(subject) < (MODIFIER.test(subject) ? 3 : 2);
      })
      .map((rule) => rule.selector);

    expect(underweight).toEqual([]);
  });
});
