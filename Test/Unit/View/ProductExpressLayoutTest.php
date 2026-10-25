<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\View;

use PHPUnit\Framework\TestCase;
use SimpleXMLElement;

/**
 * TWO-26616: the product page "Buy with <brand>" button and its checkout
 * preselect on Hyvä.
 * TWO-26659: the product page promo message on Hyvä.
 *
 * The button and promo blocks are the base module's; this module swaps the
 * button's template and moves both into the purchase column, and only on Hyvä
 * themes. Each case below is a way the wiring can break silently:
 * a layout pointing at a template that does not exist renders nothing, a
 * handle without the hyva_ prefix would replace the working Luma template too,
 * and a preselect block with no view model fatals the checkout body.
 */
class ProductExpressLayoutTest extends TestCase
{
    private const VIEW_ROOT = __DIR__ . '/../../../view/frontend';

    /**
     * @dataProvider templateReferenceProvider
     */
    public function testLayoutPointsAtAShippedTemplate(string $layout, string $blockName, string $case): void
    {
        // Given the layout; when the block is found; then its template must exist in this module.
        $block = $this->findBlock($layout, $blockName);
        $this->assertNotNull($block, "{$case}: {$layout} has no block named {$blockName}");

        $template = (string) $block['template'];
        $this->assertStringStartsWith('Two_GatewayHyva::', $template, $case);
        $this->assertFileExists(
            self::VIEW_ROOT . '/templates/' . substr($template, strlen('Two_GatewayHyva::')),
            $case
        );
    }

    /**
     * @return array<string, array{string, string, string}>
     */
    public static function templateReferenceProvider(): array
    {
        return [
            'product button' => ['hyva_catalog_product_view.xml', 'two.product.express', 'product button'],
            'checkout preselect' => ['hyva_checkout_index_index.xml', 'two.express.preselect', 'checkout preselect'],
        ];
    }

    /**
     * @dataProvider productBlockProvider
     */
    public function testProductBlockIsOnlyTouchedOnHyvaThemes(string $blockName, int $references, string $case): void
    {
        // Given every layout file; then only hyva_-prefixed ones may touch the base block.
        foreach (glob(self::VIEW_ROOT . '/layout/*.xml') ?: [] as $path) {
            if (strpos(basename($path), 'hyva_') === 0) {
                continue;
            }
            $this->assertStringNotContainsString(
                $blockName,
                (string) file_get_contents($path),
                basename($path) . " would change the {$case} on Luma as well"
            );
        }
    }

    /**
     * @dataProvider productBlockProvider
     */
    public function testProductBlockKeepsTheBaseBlock(string $blockName, int $references, string $case): void
    {
        // Given the Hyvä handle; then it never declares a second block, and only re-templates where expected.
        $xml = $this->load('hyva_catalog_product_view.xml');

        $this->assertCount($references, $xml->xpath("//referenceBlock[@name=\"{$blockName}\"]"), $case);
        $this->assertCount(0, $xml->xpath("//block[@name=\"{$blockName}\"]"), $case);
        $this->assertCount(0, $xml->xpath("//referenceBlock[@name=\"{$blockName}\"]/@class"), $case);
    }

    /**
     * Base block, how many times the Hyvä handle references it (1 = template swapped), description.
     *
     * @return array<string, array{string, int, string}>
     */
    public static function productBlockProvider(): array
    {
        return [
            'product button' => ['two.product.express', 1, 'product button'],
            'promo message' => ['two.product.promo', 0, 'promo message'],
        ];
    }

    /**
     * @dataProvider placementProvider
     */
    public function testProductBlockSitsInThePurchaseColumn(
        string $blockName,
        string $destination,
        string $after,
        string $case
    ): void {
        // Given the Hyvä handle; then the block moves into the container Hyvä renders under add to cart.
        // Left where the base module puts it, it lands at the foot of the whole product page.
        $move = $this->load('hyva_catalog_product_view.xml')->xpath("//move[@element=\"{$blockName}\"]");

        $this->assertCount(1, $move, $case);
        $this->assertSame($destination, (string) $move[0]['destination'], $case);
        $this->assertSame($after, (string) $move[0]['after'], $case);
    }

    /**
     * Base block, destination container, sibling it follows ('' = none), description.
     * The promo follows the button, as the base module orders the two on Luma.
     *
     * @return array<string, array{string, string, string, string}>
     */
    public static function placementProvider(): array
    {
        return [
            'product button' => ['two.product.express', 'product.info.additional', '', 'product button'],
            'promo message' => ['two.product.promo', 'product.info.additional', 'two.product.express', 'promo message'],
        ];
    }

    public function testButtonMovesBeforeThePromoThatFollowsIt(): void
    {
        // Given the Hyvä handle; then the button's move is declared first.
        // Magento applies moves in the order the layout declares them, and skips an `after` naming a
        // sibling that is not in the container yet as a broken reference, which leaves the promo first.
        $moved = array_map(
            static fn (SimpleXMLElement $move): string => (string) $move['element'],
            $this->load('hyva_catalog_product_view.xml')->xpath('//move')
        );

        $this->assertSame(['two.product.express', 'two.product.promo'], $moved);
    }

    public function testProductStylesheetIsShipped(): void
    {
        // Given the Hyvä handle; then the stylesheet that resizes the label and promo text exists in this module.
        // A missing asset is a 404 on the page and text left at the base size.
        $css = $this->load('hyva_catalog_product_view.xml')->xpath('//head/css/@src');

        $this->assertCount(1, $css);
        $this->assertStringStartsWith('Two_GatewayHyva::', (string) $css[0]);
        $this->assertFileExists(
            self::VIEW_ROOT . '/web/' . substr((string) $css[0], strlen('Two_GatewayHyva::'))
        );
    }

    public function testPreselectReceivesTheBrandedViewModel(): void
    {
        // Given the preselect block; then the method code reaches it through the branded view model.
        $block = $this->findBlock('hyva_checkout_index_index.xml', 'two.express.preselect');
        $this->assertNotNull($block);

        $argument = $block->xpath('arguments/argument[@name="branded_view_model"]');
        $this->assertCount(1, $argument);
        $this->assertSame(
            'Two\\GatewayHyva\\ViewModel\\BrandedHyvaViewModelInterface',
            trim((string) $argument[0])
        );
    }

    private function findBlock(string $layout, string $name): ?SimpleXMLElement
    {
        $matches = $this->load($layout)->xpath(
            sprintf('//block[@name="%1$s"] | //referenceBlock[@name="%1$s"]', $name)
        );

        return $matches ? $matches[0] : null;
    }

    private function load(string $layout): SimpleXMLElement
    {
        $xml = simplexml_load_file(self::VIEW_ROOT . '/layout/' . $layout);
        $this->assertInstanceOf(SimpleXMLElement::class, $xml, "{$layout} does not parse");

        return $xml;
    }
}
