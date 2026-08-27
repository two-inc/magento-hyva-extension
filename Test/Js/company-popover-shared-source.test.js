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
});

describe('the popover has styling on a store that never rebuilt Tailwind', () => {
    /*
     * The Tailwind rebuild is the MERCHANT'S, so a utility only this module asks
     * for may never be generated — and that failure is silent, rendering as an
     * unstyled box that still claims whatever it says. Every class the shared
     * panel builds its DOM from therefore needs a rule in this file.
     */
    test.each([
        ['.two-company-field-wrap', 'the positioning context the panel anchors against'],
        ['.two-company-dropdown', 'the panel itself'],
        ['.two-company-dropdown[hidden]', 'closed, so nothing inside it is a tab stop'],
        ['.two-company-dropdown__search', 'the query row'],
        ['.two-company-dropdown__query', 'the query field'],
        ['.two-company-dropdown__spinner', 'the in-field searching indicator'],
        ['.two-company-dropdown__spinner--active', 'that indicator while a search is on the wire'],
        ['.two-company-dropdown__results', 'the results host'],
        ['.two-company-dropdown__row', 'a result row'],
        ['.two-company-dropdown__row--active', 'the arrow-key highlighted row'],
        ['.two-company-dropdown__message', 'the too-short and no-matches lines'],
        ['.two-company-dropdown__message--unavailable', 'the search being down, which must not read as no matches'],
        ['.two-company-mode-chips', 'the chip row INSIDE the panel'],
        ['.two-company-mode-chip', 'a mode chip'],
        ['.two-company-mode-chip--selected', 'the selected mode'],
        ['.two-company-mode-chip.two-hidden', 'a mode the country cannot serve'],
        ['.two-company-search-back', 'the only route back out of manual entry']
    ])('%s is styled here (%s)', (selector) => {
        expect(read(CUSTOM_CSS)).toContain(selector + ' {');
    });

    test('the popover spinner points at an image this module actually ships', () => {
        // Scoped to the popover's OWN rule. This file already carries a second
        // spinner (`.two-company-search__spinner`) naming the same asset, so an
        // unscoped search for the URL passes on that one's strength and proves
        // nothing about this one.
        const block = read(CUSTOM_CSS).match(
            /\.two-company-dropdown__spinner \{[^}]*\}/
        );

        expect(block).not.toBeNull();
        const url = block[0].match(/url\("([^"]+)"\)/);
        expect(url).not.toBeNull();

        // The rule is copied from the base plugin, whose own loader.gif sits at
        // the same relative offset — so a correct-looking URL can still 404.
        expect(fs.existsSync(
            path.join(ROOT, 'view/frontend/web/css', url[1])
        )).toBe(true);
    });
});
