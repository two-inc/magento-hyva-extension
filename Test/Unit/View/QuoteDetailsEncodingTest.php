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
 * Three hostile inputs matter, and all three are ways for data to reintroduce
 * the outage CspInlineScriptTemplateTest guards statically:
 *
 *  - a script END tag, which closes the inline block early. That is script
 *    execution on the checkout AND it relocates the last tag-open / tag-close
 *    that Hyva\Theme\Model\HtmlPageContent::extractLastElement() searches for,
 *    so the CSP nonce is placed on the wrong element.
 *  - a script OPEN tag, which does not close anything but is exactly the second
 *    occurrence that hijacks that last-occurrence search. Worse in company with
 *    `<!--`: an `<!--<script>` sequence puts the tokenizer into
 *    script-data-double-escaped state, where the real closing tag stops
 *    terminating the element at all.
 *  - an apostrophe, which closes a single-quoted JS string literal. A buyer
 *    surname is enough.
 *
 * JSON_HEX_TAG and JSON_HEX_APOS are what stop those, and JSON_UNESCAPED_SLASHES
 * must stay off: it strips the incidental protection plain json_encode() gives
 * by escaping the slash in an end tag.
 *
 * The test reads the flag expressions out of the templates rather than
 * duplicating them, and asserts EVERY encode site in each template, so a second
 * unprotected call cannot hide behind a well-flagged first one. It asserts the
 * property — the encoded output can contain neither a tag-open nor a tag-close
 * nor an apostrophe, and round-trips losslessly — rather than the presence of a
 * particular flag name.
 */
class QuoteDetailsEncodingTest extends TestCase
{
    private const TEMPLATE_ROOT = __DIR__ . '/../../../view/frontend/templates';

    /**
     * Path of the one template that carries the payload into an HTML attribute
     * rather than into JavaScript, and so is protected differently.
     */
    private const ATTRIBUTE_TEMPLATE = 'component/payment/method/gateway_method.phtml';

    /**
     * Every template that pulls the quote payload in, discovered rather than
     * listed: a fourth one that starts embedding it must not be silently
     * unguarded. The attribute-path template is excluded here and covered by its
     * own test below.
     *
     * @return array<string, array{0: string}>
     */
    public static function quoteEncodingTemplateProvider(): array
    {
        $cases = [];

        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator(self::TEMPLATE_ROOT, \FilesystemIterator::SKIP_DOTS)
        );

        /** @var \SplFileInfo $file */
        foreach ($iterator as $file) {
            if ($file->getExtension() !== 'phtml') {
                continue;
            }
            $contents = (string) file_get_contents($file->getPathname());
            // Keyed on reading the payload plus encoding something, never on a
            // variable name: an encode under any other name must not escape the
            // flag assertions.
            if (strpos($contents, 'getQuoteDetails()') === false) {
                continue;
            }
            if (strpos(self::withoutCommentsStatic($contents), 'json_encode(') === false) {
                continue;
            }
            $relative = str_replace(self::TEMPLATE_ROOT . '/', '', $file->getPathname());
            if ($relative === self::ATTRIBUTE_TEMPLATE) {
                continue;
            }
            $cases[$relative] = [$file->getPathname()];
        }

        self::assertNotEmpty($cases, 'Expected to find templates encoding the quote payload');

        return $cases;
    }

    /**
     * Every template that pulls the quote payload in at all, however it embeds
     * it — whole via json_encode, or one scalar at a time.
     *
     * @return array<string, array{0: string}>
     */
    public static function quoteConsumingTemplateProvider(): array
    {
        $cases = [];

        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator(self::TEMPLATE_ROOT, \FilesystemIterator::SKIP_DOTS)
        );

        /** @var \SplFileInfo $file */
        foreach ($iterator as $file) {
            if ($file->getExtension() !== 'phtml') {
                continue;
            }
            $contents = (string) file_get_contents($file->getPathname());
            if (strpos($contents, 'getQuoteDetails()') === false) {
                continue;
            }
            $relative = str_replace(self::TEMPLATE_ROOT . '/', '', $file->getPathname());
            $cases[$relative] = [$file->getPathname()];
        }

        self::assertNotEmpty($cases, 'Expected to find templates consuming the quote payload');

        return $cases;
    }

    /**
     * Nothing derived from the quote payload may be echoed raw, whether it is
     * the whole payload or a single field lifted out of it. json_encode() with
     * flags, escapeJs() and htmlspecialchars() are the three sanctioned wrappers;
     * a bare `<?= $quoteSomething ?>` is not.
     *
     * @dataProvider quoteConsumingTemplateProvider
     */
    public function testNoQuoteDerivedValueIsEchoedRaw(string $path): void
    {
        $contents = (string) file_get_contents($path);

        // Any echo tag, not just a bare variable: an array element or a method
        // call on the payload reaches the same JS sink.
        preg_match_all('/<\?=([\s\S]*?)\?>/', $contents, $matches);

        $wrappers = ['json_encode(', 'escapeJs(', 'escapeHtml', 'escapeUrl', 'htmlspecialchars('];

        $raw = [];
        foreach ($matches[1] as $rawExpression) {
            $expression = trim((string) preg_replace('#/\*[\s\S]*?\*/#', ' ', $rawExpression));

            $readsPayload = preg_match('/\$quote\w*/i', $expression)
                || strpos($expression, 'getQuoteDetails') !== false;
            if (!$readsPayload) {
                continue;
            }

            foreach ($wrappers as $wrapper) {
                if (strpos($expression, $wrapper) !== false) {
                    continue 2;
                }
            }

            // A bare variable assigned from json_encode() in this template is
            // already the encoded form, and flagSetsUsedBy() asserts that call's
            // flags — every call in the file, so this exemption cannot be used to
            // launder an unchecked encode.
            if (preg_match('/\A\$[A-Za-z_]\w*\z/', $expression)
                && preg_match('/' . preg_quote($expression, '/') . '\s*=\s*json_encode\(/', $contents)
            ) {
                continue;
            }

            $raw[] = $expression;
        }

        $this->assertSame(
            [],
            $raw,
            sprintf(
                '%s echoes a quote-derived value with no escaping: %s. The quote payload is '
                . 'buyer-controlled, so every interpolation of it needs json_encode() with the HEX '
                . 'flags, escapeJs() or htmlspecialchars().',
                basename($path),
                implode(', ', $raw)
            )
        );
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
                    // The inch mark is the input that broke JSON.parse() on the
                    // shipping step when the payload was a quoted JSON string.
                    'name' => '24" Monitor </' . 'script><' . 'script>alert(1)</' . 'script>',
                    'description' => "It's a </" . 'SCRIPT' . '> in mixed case',
                ],
                [
                    // Drives the tokenizer into script-data-double-escaped state,
                    // where the real closing tag stops ending the element.
                    'name' => '<!--<' . 'script>',
                    // Non-ASCII, so the round-trip assertion has something to be
                    // lossy about if the escaping is ever changed carelessly.
                    'description' => '<' . 'SCRIPT src=//evil> naïve Ærø ✓',
                ],
            ],
        ];
    }

    /**
     * @dataProvider quoteEncodingTemplateProvider
     */
    public function testEncodedQuoteCannotCloseTheScriptBlockOrTheStringLiteral(string $path): void
    {
        foreach ($this->flagSetsUsedBy($path) as $flags) {
            $encoded = json_encode($this->hostileQuote(), $flags);
            $this->assertNotFalse($encoded, 'Fixture must encode');
            $this->assertPayloadIsInert($path, (string) $encoded);
        }
    }

    private function assertPayloadIsInert(string $path, string $encoded): void
    {

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

        $this->assertStringNotContainsStringIgnoringCase(
            '<' . 'script',
            $encoded,
            sprintf(
                '%s encodes the buyer-controlled quote payload without neutralising a script OPEN '
                . 'tag. It closes nothing, but it is exactly the second occurrence that hijacks '
                . "Hyva's last-occurrence search for the element to sign — the outage this guards "
                . 'against, arriving as data instead of as a comment. Add JSON_HEX_TAG.',
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
        foreach ($this->flagSetsUsedBy($path) as $flags) {
            $encoded = (string) json_encode($this->hostileQuote(), $flags);
            $this->assertRoundTrips($path, $encoded);
        }
    }

    private function assertRoundTrips(string $path, string $encoded): void
    {
        $this->assertSame(
            $this->hostileQuote(),
            json_decode($encoded, true),
            sprintf(
                '%s must encode the quote payload losslessly — escaping it must not change what '
                . 'the checkout reads back: %s',
                basename($path),
                $encoded
            )
        );
        $this->assertStringStartsWith('{"', $encoded);
    }

    /**
     * A malformed byte in a product name makes json_encode() return false. Both
     * bare and quoted interpolations then emit nothing — `quote : ,` — which is a
     * parse error that kills every Alpine.data() registration in the block: this
     * outage, arriving through data. JSON_INVALID_UTF8_SUBSTITUTE keeps the encode
     * succeeding, and the `?: '{}'` is the second line of defence for any other
     * reason an encode can fail, so the block still parses and the country lookup
     * degrades to reading the DOM instead of dying.
     *
     * @dataProvider quoteEncodingTemplateProvider
     */
    public function testMalformedUtf8CannotCollapseTheEncoding(string $path): void
    {
        // A lone 0xE9 byte: valid latin1, invalid UTF-8. A product name imported
        // from a legacy feed is the realistic source.
        $malformed = ['items' => [['name' => "Caf\xE9 Widget"]]];

        foreach ($this->flagSetsUsedBy($path) as $flags) {
            $this->assertNotFalse(
                json_encode($malformed, $flags),
                sprintf(
                    '%s encodes the quote payload with flags that return false on malformed UTF-8. '
                    . 'The template then emits nothing where a value belongs, which is a syntax '
                    . 'error that kills every Alpine.data() registration in the block. Add '
                    . 'JSON_INVALID_UTF8_SUBSTITUTE.',
                    basename($path)
                )
            );
        }

        $this->assertMatchesRegularExpression(
            '/\)\s*\?:\s*\x27\{\}\x27/',
            (string) file_get_contents($path),
            sprintf(
                '%s must fall back to an empty object when json_encode() fails for any other '
                . 'reason, rather than emitting nothing into the JS.',
                basename($path)
            )
        );
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
     * Every flag set passed to json_encode() anywhere in the template, resolved
     * to ints.
     *
     * Deliberately keyed on the CALL, not on the argument's name. Keying on a
     * `$quote`-ish variable name let a second encode under any other name — or
     * one whose flags were passed as a variable — become invisible to this test,
     * while testNoQuoteDerivedValueIsEchoedRaw() excused the same variable
     * *because* it was assigned from json_encode(). The two guards excused each
     * other. In a template that reads the quote payload at all, every encode site
     * has to declare literal flags.
     *
     * @return array<int, int>
     */
    private function flagSetsUsedBy(string $path): array
    {
        $contents = $this->withoutComments((string) file_get_contents($path));
        $arguments = $this->jsonEncodeArgumentLists($contents);

        $this->assertNotSame(
            [],
            $arguments,
            sprintf('%s must encode the quote payload with json_encode()', basename($path))
        );

        $flagSets = [];
        foreach ($arguments as $argumentList) {
            $parts = $this->splitTopLevel($argumentList);
            $expression = trim($parts[1] ?? '');

            $this->assertNotSame(
                '',
                $expression,
                sprintf(
                    '%s calls json_encode() with no flags. That leaves the buyer-controlled '
                    . 'payload able to close the inline script block. Argument list: %s',
                    basename($path),
                    $argumentList
                )
            );

            $this->assertMatchesRegularExpression(
                '/\A[A-Z0-9_]+(?:\s*\|\s*[A-Z0-9_]+)*\z/',
                $expression,
                sprintf(
                    '%s passes json_encode() flags as %s. They must be a literal expression of '
                    . 'flag constants, or this test cannot see what the encoding actually is and '
                    . 'the site becomes invisible to the guard.',
                    basename($path),
                    $expression
                )
            );

            $flags = 0;
            foreach (preg_split('/\s*\|\s*/', $expression) as $name) {
                $name = trim($name);
                $this->assertTrue(
                    defined($name),
                    sprintf('%s passes unknown json_encode flag %s', basename($path), $name)
                );
                $flags |= (int) constant($name);
            }
            $flagSets[] = $flags;
        }

        return $flagSets;
    }

    /**
     * Strip comments, so a comment that mentions json_encode() — several of them
     * explain exactly this guard — is not scanned as a call site.
     */
    private static function withoutCommentsStatic(string $contents): string
    {
        $contents = (string) preg_replace('#/\*[\s\S]*?\*/#', ' ', $contents);

        return (string) preg_replace('#(?<![:"\'])//[^\n]*#', ' ', $contents);
    }

    private function withoutComments(string $contents): string
    {
        // Block comments first, then line comments, protecting the `//` in a URL.
        $contents = (string) preg_replace('#/\*[\s\S]*?\*/#', ' ', $contents);

        return (string) preg_replace('#(?<![:"\'])//[^\n]*#', ' ', $contents);
    }

    /**
     * Argument lists of every json_encode() call in the source, found by walking
     * parentheses rather than by regex so a multi-line call, a nested call or a
     * trailing `?: '{}'` cannot hide a site.
     *
     * @return array<int, string>
     */
    private function jsonEncodeArgumentLists(string $contents): array
    {
        $lists = [];
        $offset = 0;
        $needle = 'json_encode(';

        while (($found = strpos($contents, $needle, $offset)) !== false) {
            $cursor = $found + strlen($needle);
            $depth = 1;
            $length = strlen($contents);

            while ($cursor < $length && $depth > 0) {
                if ($contents[$cursor] === '(') {
                    $depth++;
                } elseif ($contents[$cursor] === ')') {
                    $depth--;
                }
                $cursor++;
            }

            $lists[] = substr(
                $contents,
                $found + strlen($needle),
                $cursor - 1 - ($found + strlen($needle))
            );
            $offset = $cursor;
        }

        return $lists;
    }

    /**
     * Split an argument list on top-level commas only.
     *
     * @return array<int, string>
     */
    private function splitTopLevel(string $argumentList): array
    {
        $parts = [];
        $depth = 0;
        $buffer = '';

        foreach (str_split($argumentList) as $char) {
            if ($char === '(' || $char === '[') {
                $depth++;
            } elseif ($char === ')' || $char === ']') {
                $depth--;
            }

            if ($char === ',' && $depth === 0) {
                $parts[] = $buffer;
                $buffer = '';
                continue;
            }
            $buffer .= $char;
        }

        if (trim($buffer) !== '') {
            $parts[] = $buffer;
        }

        return $parts;
    }
}
