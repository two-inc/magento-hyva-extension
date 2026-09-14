/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25503 — the company popover is the BASE plugin's file, not a copy.
 *
 * This checkout used to carry its own popover, and the two drifted: the base
 * one put the mode chips inside the panel, this one left them in a separate row
 * the dropdown drew over. The fix is to stop having two, which means the page
 * must actually load the base plugin's implementation — a reference nothing else
 * in the suite would notice losing, because every other test drives the
 * component rather than the page that assembles it.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * @param {string} relativePath repo-relative
 * @returns {string} file contents
 */
function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const CHECKOUT_LAYOUT = 'view/frontend/layout/hyva_checkout_index_index.xml';
const CUSTOM_CSS = 'view/frontend/web/css/custom.css';

/**
 * The whole capture implementation, in load order. `Two_Gateway::`, not
 * `Two_GatewayHyva::` — this module owns no second copy of any of them to drift
 * from the first, and each is framework-free with a UMD tail so it attaches its
 * global with no RequireJS on the page.
 */
const BASE_MODULES = [
    ['company-search-panel.js', 'TwoCompanySearchPanel', 'the popover'],
    ['company-identity.js', 'TwoCompanyIdentity', 'the captured company'],
    ['sole-trader.js', 'TwoSoleTrader', 'the hosted signup flow'],
    ['company-capture-component.js', 'TwoCompanyCaptureComponent', 'the capture controller']
];

describe('the popover implementation is loaded from the base plugin', () => {
    test.each(BASE_MODULES)(
        'the checkout page pulls in the base plugin\'s %s (%s — %s)',
        (file) => {
            expect(read(CHECKOUT_LAYOUT)).toContain(
                `<script src="Two_Gateway::js/model/${file}"/>`
            );
        }
    );

    test('this module ships no copy of any of them', () => {
        // A file of the same name here would be loaded by nothing and drift
        // unnoticed — which is how the two popovers diverged.
        BASE_MODULES.forEach(([file]) => {
            expect(fs.existsSync(path.join(ROOT, 'view/frontend/web/js/model', file))).toBe(false);
        });
    });

    test('it is loaded before this module\'s own stylesheet', () => {
        const layout = read(CHECKOUT_LAYOUT);

        expect(layout.indexOf('company-search-panel.js'))
            .toBeLessThan(layout.indexOf('Two_GatewayHyva::css/custom.css'));
    });

    test('the popover\'s STYLING comes from the base plugin too', () => {
        expect(read(CHECKOUT_LAYOUT)).toContain(
            '<css src="Two_Gateway::css/style.css"/>'
        );
    });

    test('the base stylesheet loads first, so this module keeps the last word', () => {
        // Any class that genuinely needs to mesh with Hyvä's styling gets a
        // selective override in custom.css; an override that loaded first would
        // be the one overridden.
        const layout = read(CHECKOUT_LAYOUT);

        expect(layout.indexOf('Two_Gateway::css/style.css'))
            .toBeLessThan(layout.indexOf('Two_GatewayHyva::css/custom.css'));
    });
});

describe('no copy of the popover\'s styling creeps back in here', () => {
    /*
     * The guard against the obvious wrong turn. Copying these rules works, and
     * it duplicates precisely the thing this ticket exists to de-duplicate —
     * so the popover's appearance has ONE source, the base stylesheet, and
     * whatever genuinely needs to mesh with Hyvä's styling is a selective
     * override written after someone has looked at the result.
     *
     * Matched at the START of a selector: this file legitimately MENTIONS
     * `.two-company-dropdown__query`, in the `:not()` that keeps its own
     * company-field rules off the popover's query box.
     */
    test.each([
        ['.two-company-field-wrap', 'the positioning context the panel anchors against'],
        ['.two-company-dropdown', 'the panel and every part of it'],
        ['.two-company-search-back', 'the route back out of manual entry'],
        ['.two-field-action-link', 'the appearance the shared chrome gives an action link'],
        ['.two-hidden', 'the panel\'s own hiding class, which no theme defines']
    ])('%s has no rule of its own here (%s)', (selector) => {
        const ownRule = new RegExp(
            '^\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^,{]*\\{',
            'm'
        );

        expect(read(CUSTOM_CSS)).not.toMatch(ownRule);
    });

    /*
     * The mode chips are the one exception (ABN-593): they share the term
     * chips' palette, which this module already owns, so they are repainted
     * here. Padding is allowed only as the counterweight to the border width
     * declared beside it, and only at the one box size below — anything that
     * re-lays-out the chips is still the base stylesheet's alone.
     */
    const PALETTE = [
        'color',
        'background',
        'background-color',
        'border',
        'border-color',
        'border-width',
        'border-style',
        'outline',
        'outline-offset',
        'padding'
    ];

    /*
     * This module out-scores the base stylesheet on the mode chip, so it owns
     * the chip's box outright — moving the base's padding no longer moves the
     * Hyva chip, and nothing else pins this. 7/12 IS that box.
     */
    const EDGE = { top: 7, left: 12 };

    const LENGTH = /^[\d.]+(px|em|rem)?$/;

    const STYLE_RULE = 1;
    const KEYFRAMES_RULE = 7;
    const GROUPING_RULES = [4, 12]; // @media, @supports

    /**
     * A rule nested in an at-rule paints exactly as one at the top level does.
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

    /** @returns {CSSStyleRule[]} the rules this module aims at a mode chip */
    function modeChipRules() {
        const style = document.createElement('style');
        style.textContent = read(CUSTOM_CSS);
        document.head.appendChild(style);

        return styleRules(style.sheet.cssRules).filter((rule) =>
            rule.selectorText.includes('.two-company-mode-chip')
        );
    }

    test('the mode chips are repainted here, never re-laid-out', () => {
        const declared = modeChipRules().flatMap((rule) => Array.from(rule.style));

        expect(declared.length).toBeGreaterThan(0);
        expect(declared.filter((property) => !PALETTE.includes(property))).toEqual([]);
    });

    test('a mode chip rule that pads also pins the border it pads against', () => {
        const boxes = modeChipRules()
            .filter((rule) => rule.style.getPropertyValue('padding'))
            .map((rule) => {
                const edge = rule.style.getPropertyValue('border-width')
                    || rule.style.getPropertyValue('border');
                // Per-side widths would make one number per edge, and the sum
                // below would silently pin only the first of them.
                const lengths = edge.trim().split(/\s+/).filter((part) => LENGTH.test(part));
                if (lengths.length > 1) {
                    throw new Error(`border-width is per-side: ${rule.selectorText}`);
                }
                const width = parseFloat(lengths[0]);
                const sides = rule.style.getPropertyValue('padding').trim().split(/\s+/);
                // Three or four sides put the left edge somewhere other than
                // the second value, which is where this reads it from.
                if (sides.length > 2) {
                    throw new Error(`padding is per-side: ${rule.selectorText}`);
                }
                const [top, left] = sides.map(parseFloat);

                return { selector: rule.selectorText, top: top + width, left: left + width };
            });

        expect(boxes.length).toBeGreaterThan(0);
        boxes.forEach(({ selector, top, left }) => {
            expect({ selector, top, left }).toEqual({ selector, ...EDGE });
        });
    });
});
