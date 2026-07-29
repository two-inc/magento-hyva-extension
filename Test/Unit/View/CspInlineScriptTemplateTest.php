<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\View;

use PHPUnit\Framework\TestCase;

/**
 * Guards the shapes of inline-script template that Hyva's CSP registration
 * cannot handle.
 *
 * Hyva Checkout enforces CSP with inline scripts disallowed
 * (csp/policies/storefront_hyva_checkout_index_index/scripts/inline = 0,
 * report_only = 0, shipped by hyva-themes/magento2-hyva-checkout itself), so
 * every inline script needs the nonce or hash that
 * Hyva\Theme\ViewModel\HyvaCsp::registerInlineScript() registers. That helper
 * finds the element to act on with
 * Hyva\Theme\Model\HtmlPageContent::extractLastElement(), which has two
 * preconditions:
 *
 *  1. the output buffer as it stands when the helper is called — ob_get_contents(),
 *     so page-wide, not just this block — must END with the closing tag, which is
 *     also why cross-template render order can break this and why a file-local
 *     guard cannot see that, and
 *  2. the opening tag is resolved by a LAST-occurrence, CASE-INSENSITIVE
 *     (mb_strripos) search for the tag-open string.
 *
 * Break (2) with a second literal tag-open and the nonce is written into the
 * middle of the JavaScript, or the hash is taken over the wrong substring,
 * while the real tag goes out without a valid source. Break (1) and the helper
 * registers nothing at all. Both fail silently: nothing throws server-side and
 * the script is present in the DOM, it just never executes.
 *
 * That is what killed the entire Hyva payment tile — a single tag-open string
 * inside a comment meant no Alpine.data() registration in the block ever ran,
 * so every x-data name in the tile failed to resolve under the CSP-friendly
 * Alpine build.
 *
 * The rules below are deliberately blunt rather than clever. Text alone cannot
 * distinguish a real tag from a mention of one — and neither can mb_strripos,
 * which is the whole problem — so the guard forbids the second occurrence
 * outright instead of trying to classify it. Same for the trailer: rather than
 * hunting for constructs that emit, it requires the only thing after the
 * closing tag to be the registration call.
 *
 * Static analysis only. A tag-open string that appears for the first time at
 * render time (an interpolated config value, a buyer-supplied product name) is
 * out of reach here; the escaping at each interpolation site is what covers
 * that, and QuoteDetailsEncodingTest asserts it for the buyer-controlled
 * payloads.
 */
class CspInlineScriptTemplateTest extends TestCase
{
    private const TEMPLATE_ROOT = __DIR__ . '/../../../view';

    /**
     * The only thing allowed after the closing tag: the registration call, with
     * or without a closing PHP tag (Magento style often omits it at EOF).
     */
    private const TRAILER_PATTERN = '/\A\s*<\?php\s+\$\w+->registerInlineScript\(\)\s*;?\s*(?:\?>)?\s*\z/';

    /**
     * Assembled at runtime so this test file never contains the literal string
     * it forbids, which would otherwise make the test its own counter-example.
     */
    private static function tagOpen(): string
    {
        return '<' . 'script';
    }

    private static function tagClose(): string
    {
        return '</' . 'script>';
    }

    /**
     * Every .phtml that mentions the tag-open string at all. Deliberately not
     * narrowed to "renders an inline script": a template that only mentions the
     * string is exactly the case that broke, and one that renders an external
     * `src=` include has no business mentioning it either.
     *
     * @return array<string, array{0: string}>
     */
    public static function scriptTagTemplateProvider(): array
    {
        $cases = [];
        $needle = strtolower(self::tagOpen());

        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator(self::TEMPLATE_ROOT, \FilesystemIterator::SKIP_DOTS)
        );

        /** @var \SplFileInfo $file */
        foreach ($iterator as $file) {
            if ($file->getExtension() !== 'phtml') {
                continue;
            }
            $contents = strtolower((string) file_get_contents($file->getPathname()));
            if (strpos($contents, $needle) === false) {
                continue;
            }
            $relative = str_replace(self::TEMPLATE_ROOT . '/', '', $file->getPathname());
            $cases[$relative] = [$file->getPathname()];
        }

        self::assertNotEmpty($cases, 'Expected to find script-tag templates under view/');

        return $cases;
    }

    /**
     * @dataProvider scriptTagTemplateProvider
     */
    public function testExactlyOneTagOpen(string $path): void
    {
        $this->assertSame(
            1,
            $this->countCaseInsensitive($path, self::tagOpen()),
            sprintf(
                '%s contains the literal script-open string more than once. Hyva resolves the tag '
                . 'to sign with a last-occurrence, case-insensitive search, so a second occurrence '
                . '— in any casing, including inside a comment or a JS string — leaves the real '
                . 'tag unsigned and the enforced checkout CSP silently refuses the whole block. '
                . 'Write it as a concatenation or reword the comment.',
                basename($path)
            )
        );
    }

    /**
     * @dataProvider scriptTagTemplateProvider
     */
    public function testExactlyOneTagClose(string $path): void
    {
        $this->assertSame(
            1,
            $this->countCaseInsensitive($path, self::tagClose()),
            sprintf(
                '%s contains the literal script-close string more than once. extractLastElement() '
                . 'only recognises the block when the output ends with it, and a second occurrence '
                . 'moves where that end is.',
                basename($path)
            )
        );
    }

    /**
     * Enforces both remaining preconditions at once: the registration call
     * exists, it comes after the closing tag, and nothing else follows the tag
     * that could leave the buffer not ending with it.
     *
     * @dataProvider scriptTagTemplateProvider
     */
    public function testOnlyTheRegistrationCallFollowsTheClosingTag(string $path): void
    {
        $contents = (string) file_get_contents($path);
        $closePos = stripos($contents, self::tagClose());
        $this->assertNotFalse(
            $closePos,
            sprintf('%s mentions a script tag but never closes one.', basename($path))
        );

        $trailer = substr($contents, $closePos + strlen(self::tagClose()));

        $this->assertMatchesRegularExpression(
            self::TRAILER_PATTERN,
            $trailer,
            sprintf(
                '%s must end with nothing but a $...->registerInlineScript() call after the '
                . 'closing script tag. The helper inspects the output buffer as it stands when '
                . 'called: anything emitted after the tag, or a call placed before it, means the '
                . 'buffer does not end with a complete script element and the helper silently '
                . 'registers nothing, so the enforced checkout CSP refuses the block. If this '
                . 'template renders only an external src= include it needs no nonce and does not '
                . 'belong in view/ mentioning the tag-open string at all — move it or rename the '
                . 'mention. Trailer was: %s',
                basename($path),
                var_export($trailer, true)
            )
        );
    }

    private function countCaseInsensitive(string $path, string $needle): int
    {
        $contents = strtolower((string) file_get_contents($path));

        return substr_count($contents, strtolower($needle));
    }
}
