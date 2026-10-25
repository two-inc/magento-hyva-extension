<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\View;

use PHPUnit\Framework\TestCase;
use SimpleXMLElement;

/**
 * TWO-26616: the product page "Buy with <brand>" button and its checkout
 * preselect on Hyvä.
 *
 * The button block is the base module's; this module swaps its template, and
 * only on Hyvä themes. Each case below is a way the wiring can break silently:
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

    public function testProductButtonIsOnlyRetemplatedOnHyvaThemes(): void
    {
        // Given every layout file; then only hyva_-prefixed ones may touch the base button block.
        foreach (glob(self::VIEW_ROOT . '/layout/*.xml') ?: [] as $path) {
            if (strpos(basename($path), 'hyva_') === 0) {
                continue;
            }
            $this->assertStringNotContainsString(
                'two.product.express',
                (string) file_get_contents($path),
                basename($path) . ' would change the button on Luma as well'
            );
        }
    }

    public function testProductButtonKeepsTheBaseBlock(): void
    {
        // Given the Hyvä handle; then it references the base block rather than declaring a second one.
        $xml = $this->load('hyva_catalog_product_view.xml');

        $this->assertCount(1, $xml->xpath('//referenceBlock[@name="two.product.express"]'));
        $this->assertCount(0, $xml->xpath('//block[@name="two.product.express"]'));
        $this->assertCount(0, $xml->xpath('//referenceBlock[@name="two.product.express"]/@class'));
    }

    public function testProductButtonSitsInThePurchaseColumn(): void
    {
        // Given the Hyvä handle; then the button moves into the container Hyvä renders under add to cart.
        // Left where the base module puts it, it lands at the foot of the whole product page.
        $move = $this->load('hyva_catalog_product_view.xml')->xpath('//move[@element="two.product.express"]');

        $this->assertCount(1, $move);
        $this->assertSame('product.info.additional', (string) $move[0]['destination']);
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
