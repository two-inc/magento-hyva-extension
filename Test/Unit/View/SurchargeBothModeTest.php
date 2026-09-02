<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\View;

use PHPUnit\Framework\TestCase;

/**
 * Guards "both" display mode (magento-plugin emits two coded totals,
 * two_surcharge + two_surcharge_incl, when the merchant shows both net and
 * gross) across the three surfaces that must each recognise both codes:
 * the cart-page Alpine template, the Hyva Checkout block registration
 * (whose `as` alias is how its TotalSegment block resolves a segment), and
 * the totals_sort placement that keeps both rows adjacent, after shipping
 * and before tax.
 *
 * Static-assertion only, matching CspInlineScriptTemplateTest/ModuleConfigTest:
 * no Alpine runtime or Magento layout merge is available in this test suite.
 */
class SurchargeBothModeTest extends TestCase
{
    private const CART_TEMPLATE = __DIR__ . '/../../../view/frontend/templates/php-cart/totals/two_surcharge.phtml';
    private const CHECKOUT_LAYOUT = __DIR__ . '/../../../view/frontend/layout/hyva_checkout_components.xml';
    private const CHECKOUT_TEMPLATE = __DIR__
        . '/../../../view/frontend/templates/checkout/price-summary/total-segments/two_surcharge.phtml';
    private const CONFIG_XML = __DIR__ . '/../../../etc/config.xml';

    public function testCartTemplateGatesOnBothCodes(): void
    {
        $contents = (string) file_get_contents(self::CART_TEMPLATE);

        $this->assertMatchesRegularExpression(
            '/x-if="segment\.code === \'two_surcharge\' \|\| segment\.code === \'two_surcharge_incl\'"/',
            $contents,
            'the x-for segment loop renders this template once per segment, so the excl and incl '
            . 'rows both need this same gate to match — a narrower one silently drops one row'
        );
    }

    public function testCartTemplateDoesNotComposeItsOwnLabel(): void
    {
        $contents = (string) file_get_contents(self::CART_TEMPLATE);

        // segment.title already carries the "(Excl. Tax)"/"(Incl. Tax)" suffix from
        // magento-plugin; a template-side label would duplicate or contradict it.
        $this->assertMatchesRegularExpression(
            '/x-text="segment\.title"/',
            $contents,
            'must render segment.title as-is, not compose a mode-specific label'
        );
    }

    public function testCheckoutTemplateGatesOnNeitherCodeHardcoded(): void
    {
        $contents = (string) file_get_contents(self::CHECKOUT_TEMPLATE);

        // The checkout template must stay generic over whatever segment its block alias
        // resolves — that's what lets one template serve both the excl and incl blocks.
        $this->assertStringNotContainsString(
            'two_surcharge',
            $contents,
            'checkout template must not hardcode a segment code — it is shared by both the '
            . 'two_surcharge and two_surcharge_incl block registrations, distinguished only by '
            . "each block's own `as` alias"
        );
    }

    public function testHyvaCheckoutLayoutRegistersBothSegmentBlocks(): void
    {
        $xml = simplexml_load_file(self::CHECKOUT_LAYOUT);
        $this->assertNotFalse($xml, 'hyva_checkout_components.xml must be valid XML');

        $blocks = $xml->xpath("//referenceBlock[@name='price-summary.total-segments']/block");
        $byAlias = [];
        foreach ($blocks as $block) {
            $byAlias[(string) $block['as']] = (string) $block['template'];
        }

        $this->assertArrayHasKey(
            'two_surcharge',
            $byAlias,
            'the excl/single-code block registration must keep its `as` alias, which is how '
            . "Hyva Checkout's TotalSegment block resolves the segment"
        );
        $this->assertArrayHasKey(
            'two_surcharge_incl',
            $byAlias,
            'both mode needs its own block/alias pair for the incl-tax segment — a single '
            . 'registration can only ever resolve one code'
        );
        $this->assertSame(
            $byAlias['two_surcharge'],
            $byAlias['two_surcharge_incl'],
            'both blocks must point at the same generic template'
        );
    }

    public function testTotalsSortPlacesBothSurchargeRowsBetweenShippingAndTax(): void
    {
        $xml = simplexml_load_file(self::CONFIG_XML);
        $this->assertNotFalse($xml, 'etc/config.xml must be valid XML');

        $sortNode = $xml->xpath('//default/sales/totals_sort')[0];
        $excl = (int) $sortNode->two_surcharge;
        $incl = (int) $sortNode->two_surcharge_incl;

        // Core totals_sort defaults: shipping=30, tax=40 (see this node's own doc comment).
        $shipping = 30;
        $tax = 40;

        $this->assertGreaterThan($shipping, $excl, 'excl-tax row must sort after shipping');
        $this->assertGreaterThan($shipping, $incl, 'incl-tax row must sort after shipping');
        $this->assertLessThan($tax, $excl, 'excl-tax row must sort before tax');
        $this->assertLessThan($tax, $incl, 'incl-tax row must sort before tax');
        $this->assertSame(
            1,
            abs($incl - $excl),
            'the two surcharge rows must be adjacent to each other, not just both between '
            . 'shipping and tax'
        );
    }
}
