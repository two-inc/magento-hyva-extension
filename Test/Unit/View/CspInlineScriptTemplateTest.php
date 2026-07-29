<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\View;

use PHPUnit\Framework\TestCase;

/**
 * Guards the shapes of inline-script template that Hyva's CSP nonce injection
 * cannot handle.
 *
 * Hyva Checkout enforces CSP with inline scripts disallowed
 * (csp/policies/storefront_hyva_checkout_index_index/scripts/inline = 0,
 * report_only = 0, shipped by hyva-themes/magento2-hyva-checkout itself), so
 * every inline script needs the nonce (or hash) that
 * Hyva\Theme\ViewModel\HyvaCsp::registerInlineScript() registers. That helper
 * finds the element to rewrite with
 * Hyva\Theme\Model\HtmlPageContent::extractLastElement(), which has two
 * preconditions:
 *
 *  1. the block's rendered output must END with the closing tag, and
 *  2. the opening tag is resolved by a LAST-occurrence, CASE-INSENSITIVE
 *     (mb_strripos) search for the tag-open string.
 *
 * Break (2) with a second literal tag-open anywhere after the real one —
 * including inside a JS comment or string — and the nonce is written into the
 * middle of the JavaScript while the real tag goes out bare. Break (1) and the
 * helper returns early and registers nothing at all. Both fail silently:
 * nothing throws server-side and the script is present in the DOM, it just
 * never executes.
 *
 * That is what killed the entire Hyva payment tile — a single tag-open string
 * inside a comment meant no Alpine.data() registration in the block ever ran,
 * so every x-data name in the tile failed to resolve under the CSP-friendly
 * Alpine build.
 *
 * Static analysis only. A tag-open string that appears for the first time at
 * render time (an interpolated config value, a translated string) is out of
 * reach here; the escaping at each interpolation site is what covers that.
 */
class CspInlineScriptTemplateTest extends TestCase
{
    private const TEMPLATE_ROOT = __DIR__ . '/../../../view';

    private const REGISTER_CALL = 'registerInlineScript()';

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
     * Every .phtml that renders an inline script: a tag-open that is not an
     * external `src=` include. Matched case-insensitively, exactly as
     * mb_strripos does.
     *
     * @return array<string, array{0: string}>
     */
    public static function inlineScriptTemplateProvider(): array
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
            if (!preg_match(self::inlineOpenTagPattern(), $contents)) {
                continue;
            }
            $relative = str_replace(self::TEMPLATE_ROOT . '/', '', $file->getPathname());
            $cases[$relative] = [$file->getPathname()];
        }

        self::assertNotEmpty($cases, 'Expected to find inline-script templates under view/');

        return $cases;
    }

    /**
     * An opening tag with no src attribute, i.e. one carrying inline code.
     */
    private static function inlineOpenTagPattern(): string
    {
        return '/' . preg_quote(self::tagOpen(), '/') . '(?![^>]*\ssrc\s*=)[^>]*>/i';
    }

    /**
     * The mb_strripos hazard: only occurrences AFTER the real opening tag can
     * hijack the search, so that is exactly what is asserted. A mention in the
     * PHP header above the tag is harmless and stays allowed.
     *
     * @dataProvider inlineScriptTemplateProvider
     */
    public function testNoSecondTagOpenAfterTheRealOne(string $path): void
    {
        $contents = (string) file_get_contents($path);

        preg_match(self::inlineOpenTagPattern(), $contents, $m, PREG_OFFSET_CAPTURE);
        $openEnd = $m[0][1] + strlen($m[0][0]);
        $body = substr($contents, $openEnd);

        $this->assertSame(
            0,
            substr_count(strtolower($body), strtolower(self::tagOpen())),
            sprintf(
                '%s repeats the literal script-open string after its opening tag. Hyva resolves '
                . 'the tag to nonce with a last-occurrence, case-insensitive search, so a second '
                . 'one (even in a comment or a JS string, in any casing) leaves the real tag '
                . 'unnonced and the enforced checkout CSP silently refuses the whole block.',
                basename($path)
            )
        );
    }

    /**
     * @dataProvider inlineScriptTemplateProvider
     */
    public function testTemplateContainsExactlyOneScriptTagClose(string $path): void
    {
        $contents = (string) file_get_contents($path);

        $this->assertSame(
            1,
            substr_count(strtolower($contents), strtolower(self::tagClose())),
            sprintf(
                '%s must contain exactly one literal script-close string; extractLastElement() '
                . 'only recognises the block when the output ends with it.',
                basename($path)
            )
        );
    }

    /**
     * registerInlineScript() only rewrites the tag when the block's output ENDS
     * with the closing tag, so nothing that emits may follow it.
     *
     * @dataProvider inlineScriptTemplateProvider
     */
    public function testNothingEmittingFollowsTheClosingTag(string $path): void
    {
        $trailer = $this->trailerAfterClosingTag($path);

        // Short-echo tags emit by definition.
        $this->assertDoesNotMatchRegularExpression(
            '/<\?=/',
            $trailer,
            sprintf('%s uses a short-echo tag after the closing script tag.', basename($path))
        );

        foreach (['echo', 'print', 'printf', 'getChildHtml'] as $emitter) {
            $this->assertStringNotContainsString(
                $emitter,
                $trailer,
                sprintf(
                    '%s calls %s after the closing script tag; Hyva then cannot recognise the '
                    . 'script as the last element and skips nonce registration entirely.',
                    basename($path),
                    $emitter
                )
            );
        }

        // Strip PHP blocks, closed or left open at EOF (both emit nothing), and
        // whatever is left must be whitespace only.
        $stripped = preg_replace('/<\?(?:php\b|\s).*?(?:\?>|$)/s', '', $trailer) ?? '';

        $this->assertSame(
            '',
            trim($stripped),
            sprintf(
                '%s emits markup after the closing script tag; Hyva then cannot recognise the '
                . 'script as the last element and skips nonce registration entirely.',
                basename($path)
            )
        );
    }

    /**
     * The registration call must come AFTER the closing tag: it inspects the
     * output buffer as it stands when called, so calling it earlier sees a
     * buffer that does not yet end with the tag and silently does nothing.
     *
     * @dataProvider inlineScriptTemplateProvider
     */
    public function testTemplateRegistersItselfAfterTheClosingTag(string $path): void
    {
        $contents = (string) file_get_contents($path);

        $registerPos = strpos($contents, self::REGISTER_CALL);
        $this->assertNotFalse(
            $registerPos,
            sprintf(
                '%s renders an inline script but never calls $hyvaCsp->%s, so it gets no nonce '
                . 'and the enforced checkout CSP refuses it.',
                basename($path),
                self::REGISTER_CALL
            )
        );

        $closePos = strripos($contents, self::tagClose());
        $this->assertNotFalse($closePos);

        $this->assertGreaterThan(
            $closePos,
            $registerPos,
            sprintf(
                '%s calls %s before the closing script tag. It reads the output buffer as it '
                . 'stands at that moment, so it finds no completed script element and registers '
                . 'nothing.',
                basename($path),
                self::REGISTER_CALL
            )
        );
    }

    /**
     * Everything after the last closing tag.
     */
    private function trailerAfterClosingTag(string $path): string
    {
        $contents = (string) file_get_contents($path);
        $closePos = strripos($contents, self::tagClose());
        $this->assertNotFalse($closePos, 'Expected a closing script tag');

        return substr($contents, $closePos + strlen(self::tagClose()));
    }
}
