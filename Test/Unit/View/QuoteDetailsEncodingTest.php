<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\View;

use PHPUnit\Framework\TestCase;

/**
 * The quote payload embedded in the checkout's inline scripts is
 * buyer-controlled: email, telephone, first and last name, and every
 * items[].name / items[].description (see ViewModel/GetQuoteDetails.php). It is
 * interpolated into inline JavaScript, sometimes bare as an object literal and
 * sometimes inside a single-quoted string literal.
 *
 * Two hostile inputs matter:
 *
 *  - a script end tag, which closes the inline block early. That is script
 *    execution on the checkout AND it relocates the last tag-open / tag-close
 *    that Hyva\Theme\Model\HtmlPageContent::extractLastElement() searches for,
 *    so the CSP nonce is placed on the wrong element — the same outage
 *    CspInlineScriptTemplateTest guards statically, reintroduced through data.
 *  - an apostrophe, which closes a single-quoted JS string literal. A buyer
 *    surname is enough.
 *
 * JSON_HEX_TAG and JSON_HEX_APOS are what stop those, and JSON_UNESCAPED_SLASHES
 * must stay off: it strips the incidental protection plain json_encode() gives
 * by escaping the slash in an end tag.
 *
 * This test reads the flag expression out of each template rather than
 * duplicating it, so weakening a template's encoding fails here. It asserts the
 * property — the encoded output cannot close a script block or a string literal
 * — not the presence of a particular flag name, so dropping JSON_HEX_TAG while
 * leaving slash-escaping on still passes, correctly: `<\/script` does not
 * terminate a script element either. Removing JSON_HEX_APOS, adding
 * JSON_UNESCAPED_SLASHES, or dropping the flags altogether all fail.
 */
class QuoteDetailsEncodingTest extends TestCase
{
    private const TEMPLATE_ROOT = __DIR__ . '/../../../view/frontend/templates';

    /**
     * Every template that encodes the quote payload into inline JavaScript.
     *
     * @return array<string, array{0: string}>
     */
    public static function quoteEncodingTemplateProvider(): array
    {
        return [
            'payment tile' => [self::TEMPLATE_ROOT . '/component/payment/method/gateway_method-csp-js.phtml'],
            'shipping step' => [self::TEMPLATE_ROOT . '/component/payment/method/shipping_company.phtml'],
            'address field' => [self::TEMPLATE_ROOT . '/form/field/companyName-csp-js.phtml'],
        ];
    }

    /**
     * Hostile values standing in for what a buyer or a catalogue can carry.
     *
     * @return array<string, string>
     */
    private function hostileQuote(): array
    {
        return [
            'email' => "o'brien@example.com",
            'first_name' => "O'Brien",
            'telephone' => "07700 900000' + alert(1) + '",
            'items' => [
                [
                    'name' => 'Widget </' . 'script><' . 'script>alert(1)</' . 'script>',
                    'description' => "It's a </" . 'SCRIPT' . '> in mixed case',
                ],
            ],
        ];
    }

    /**
     * @dataProvider quoteEncodingTemplateProvider
     */
    public function testEncodedQuoteCannotCloseTheScriptBlockOrTheStringLiteral(string $path): void
    {
        $encoded = json_encode($this->hostileQuote(), $this->flagsUsedBy($path));
        $this->assertNotFalse($encoded, 'Fixture must encode');

        $this->assertStringNotContainsStringIgnoringCase(
            '</' . 'script',
            $encoded,
            sprintf(
                '%s encodes the buyer-controlled quote payload without neutralising a script end '
                . 'tag. A product name or a buyer field carrying one closes the inline block '
                . 'early: script execution on the checkout, and the CSP nonce lands on the wrong '
                . 'element. Add JSON_HEX_TAG and do not use JSON_UNESCAPED_SLASHES.',
                basename($path)
            )
        );

        $this->assertStringNotContainsString(
            "'",
            $encoded,
            sprintf(
                '%s encodes the buyer-controlled quote payload without neutralising an apostrophe. '
                . 'The payload is interpolated into a single-quoted JS string literal, so a buyer '
                . 'surname closes it and the block dies with a syntax error. Add JSON_HEX_APOS.',
                basename($path)
            )
        );
    }

    /**
     * Structural quotes must survive, or a bare object-literal interpolation
     * stops being valid JavaScript.
     *
     * @dataProvider quoteEncodingTemplateProvider
     */
    public function testEncodedQuoteKeepsItsStructure(string $path): void
    {
        $encoded = (string) json_encode($this->hostileQuote(), $this->flagsUsedBy($path));

        $this->assertNotNull(
            json_decode($encoded, true),
            sprintf('%s must still produce decodable JSON: %s', basename($path), $encoded)
        );
        $this->assertStringStartsWith('{"', $encoded);
    }

    /**
     * gateway_method.phtml carries the same payload but into an HTML attribute,
     * not into JavaScript, so the json_encode flags are not what protects it and
     * the flag sets in the two templates legitimately differ. Its defence is the
     * htmlspecialchars() wrapper: with ENT_QUOTES a script end tag becomes
     * &lt;/script&gt; inside the attribute, which the HTML parser never treats
     * as a tag and dataset decodes back to the literal text.
     */
    public function testAttributeInterpolationIsHtmlEscaped(): void
    {
        $path = self::TEMPLATE_ROOT . '/component/payment/method/gateway_method.phtml';
        $contents = (string) file_get_contents($path);

        $this->assertMatchesRegularExpression(
            '/data-hyvacsp1="<\?=\s*htmlspecialchars\(\s*\$quoteDetails,\s*ENT_QUOTES,/',
            $contents,
            'gateway_method.phtml must pass the buyer-controlled quote payload through '
            . 'htmlspecialchars() with ENT_QUOTES. It is the only thing stopping a product name '
            . 'containing a script end tag or a quote from breaking out of the data attribute.'
        );

        $escaped = htmlspecialchars(
            (string) json_encode($this->hostileQuote()),
            ENT_QUOTES,
            'UTF-8'
        );
        $this->assertStringNotContainsStringIgnoringCase('</' . 'script', $escaped);
        $this->assertStringNotContainsString('"', $escaped);
        $this->assertStringNotContainsString("'", $escaped);
    }

    /**
     * Read the flag expression the template actually passes to json_encode for
     * the quote payload, and resolve it to an int.
     */
    private function flagsUsedBy(string $path): int
    {
        $contents = (string) file_get_contents($path);

        $matched = preg_match(
            '/json_encode\(\s*\$quoteDetails\s*,\s*([A-Z_|\s]+?)\s*,?\s*\)/',
            $contents,
            $m
        );
        $this->assertSame(
            1,
            $matched,
            sprintf(
                '%s must encode $quoteDetails with an explicit flag set. Flagless json_encode() '
                . 'leaves the buyer-controlled payload able to close the inline script block.',
                basename($path)
            )
        );

        $flags = 0;
        foreach (preg_split('/\s*\|\s*/', trim($m[1])) as $name) {
            $name = trim($name);
            $this->assertTrue(
                defined($name),
                sprintf('%s passes unknown json_encode flag %s', basename($path), $name)
            );
            $flags |= (int) constant($name);
        }

        return $flags;
    }
}
