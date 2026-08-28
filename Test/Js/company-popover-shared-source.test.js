/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25503 — the company popover is the BASE plugin's file, not a copy.
 *
 * This checkout used to carry its own popover, and the two drifted: the base
 * one put the mode chips inside the panel, this one left them in a separate row
 * the dropdown drew over. The fix is to stop having two, which means the page
 * must actually load `Two_Gateway`'s implementation — a reference nothing else
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

describe('the popover implementation is loaded from the base plugin', () => {
    test('the checkout page pulls in Two_Gateway\'s panel module', () => {
        // `Two_Gateway::`, not `Two_GatewayHyva::` — the whole point is that
        // this module owns no second implementation to drift from the first.
        expect(read(CHECKOUT_LAYOUT)).toContain(
            '<script src="Two_Gateway::js/model/company-search-panel.js"/>'
        );
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
        ['.two-company-mode-chip', 'the chips, and the row they sit in'],
        ['.two-company-search-back', 'the route back out of manual entry'],
        ['.two-hidden', 'the panel\'s own hiding class, which no theme defines']
    ])('%s has no rule of its own here (%s)', (selector) => {
        const ownRule = new RegExp(
            '^\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^,{]*\\{',
            'm'
        );

        expect(read(CUSTOM_CSS)).not.toMatch(ownRule);
    });
});
