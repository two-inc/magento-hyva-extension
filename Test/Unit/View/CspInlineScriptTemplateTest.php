<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\View;

use PHPUnit\Framework\TestCase;

/**
 * Guards the one shape of inline-script template that Hyva's CSP nonce
 * injection cannot handle.
 *
 * Hyva Checkout enforces CSP with inline scripts disallowed
 * (csp/policies/storefront_hyva_checkout_index_index/scripts/inline = 0, shipped
 * by hyva-themes/magento2-hyva-checkout itself), so every inline script needs
 * the nonce that Hyva\Theme\ViewModel\HyvaCsp::registerInlineScript() injects.
 * That injection finds the tag to rewrite with
 * Hyva\Theme\Model\HtmlPageContent::extractLastElement(), which resolves the
 * opening tag by searching for the LAST occurrence of the tag-open string in the
 * rendered output. A second literal occurrence anywhere in the block — including
 * inside a JS comment or string — hijacks that match: the nonce is written into
 * the middle of the JavaScript and the real opening tag is left bare, so the
 * browser refuses the whole block. It fails silently: nothing throws server-side
 * and the script is present in the DOM, it just never executes.
 *
 * That is what killed the entire Hyva payment tile — a single "<script>" inside
 * a comment meant no Alpine.data() registration in the block ever ran, so every
 * x-data name in the tile failed to resolve under the CSP-friendly Alpine build.
 */
class CspInlineScriptTemplateTest extends TestCase
{
    private const TEMPLATE_ROOT = __DIR__ . '/../../../view';

    /**
     * Assembled at runtime so this test file itself never contains the literal
     * string it forbids.
     */
    private function tagOpen(): string
    {
        return '<' . 'script';
    }

    private function tagClose(): string
    {
        return '</' . 'script>';
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function inlineScriptTemplateProvider(): array
    {
        $needle = '<' . 'script';
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
            if (strpos($contents, $needle) === false) {
                continue;
            }
            $relative = str_replace(self::TEMPLATE_ROOT . '/', '', $file->getPathname());
            $cases[$relative] = [$file->getPathname()];
        }

        self::assertNotEmpty($cases, 'Expected to find inline-script templates under view/');

        return $cases;
    }

    /**
     * @dataProvider inlineScriptTemplateProvider
     */
    public function testTemplateContainsExactlyOneScriptTagOpen(string $path): void
    {
        $contents = (string) file_get_contents($path);

        $this->assertSame(
            1,
            substr_count($contents, $this->tagOpen()),
            sprintf(
                '%s contains more than one literal script-open string. Hyva locates the tag to '
                . 'nonce by LAST occurrence, so a second one (even in a comment or a JS string) '
                . 'leaves the real tag unnonced and the enforced checkout CSP silently refuses '
                . 'the whole block.',
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
            substr_count($contents, $this->tagClose()),
            sprintf('%s must contain exactly one literal script-close string.', basename($path))
        );
    }

    /**
     * registerInlineScript() only rewrites the tag when the block's output ENDS
     * with the closing tag, so nothing renderable may follow it.
     *
     * @dataProvider inlineScriptTemplateProvider
     */
    public function testNothingRenderableFollowsTheClosingTag(string $path): void
    {
        $contents = (string) file_get_contents($path);
        $closePos = strpos($contents, $this->tagClose());
        $this->assertNotFalse($closePos);

        $trailer = substr($contents, $closePos + strlen($this->tagClose()));
        // Strip PHP blocks (they emit nothing here) and whitespace; anything
        // left over would be echoed after the tag and break the nonce path.
        $trailer = preg_replace('/<\?php.*?\?>/s', '', $trailer) ?? '';

        $this->assertSame(
            '',
            trim($trailer),
            sprintf(
                '%s emits markup after the closing script tag; Hyva then cannot recognise the '
                . 'script as the last element and skips nonce injection entirely.',
                basename($path)
            )
        );
    }

    /**
     * Every inline-script template must actually register itself with Hyva's CSP
     * helper, or it will be refused outright on the checkout.
     *
     * @dataProvider inlineScriptTemplateProvider
     */
    public function testTemplateRegistersItselfWithHyvaCsp(string $path): void
    {
        $contents = (string) file_get_contents($path);

        $this->assertStringContainsString(
            'registerInlineScript()',
            $contents,
            sprintf(
                '%s renders an inline script but never calls $hyvaCsp->registerInlineScript(), '
                . 'so it gets no nonce and the enforced checkout CSP refuses it.',
                basename($path)
            )
        );
    }
}
