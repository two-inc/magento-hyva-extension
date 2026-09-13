<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\Plugin;

use Hyva\Checkout\Model\ConfigData\HyvaThemes\SystemConfigPayment;
use Hyva\Checkout\Model\MethodMetaData;
use Magento\Framework\View\Layout;
use Magento\Store\Model\StoreManagerInterface;
use PHPUnit\Framework\TestCase;
use Two\Gateway\Model\Ui\CheckoutTileCopy;
use Two\GatewayHyva\Plugin\MethodMetaDataPlugin;

class MethodMetaDataPluginTest extends TestCase
{
    /**
     * ABN-554: the explainer is not a payment-brand logo, so the theme's
     * method-icon toggle decides the logo's fate and the base module's
     * about-link rule decides the explainer's.
     *
     * @dataProvider iconGateProvider
     */
    public function testTheTwoHalvesAreGatedSeparately(
        bool $aboutVisible,
        bool $iconsEnabled,
        bool $expectedCanRender,
        bool $expectExplainer,
        bool $expectLogo,
        string $description
    ): void {
        // The template gates itself on the same rule, so a withheld explainer
        // reaches the plugin as an empty render.
        $plugin = $this->plugin(
            $aboutVisible,
            $iconsEnabled,
            $aboutVisible ? '<span id="explainer"></span>' : ''
        );
        $subject = new MethodMetaData(['additional_icon_provider' => ['template' => 'Two::t.phtml']]);

        $this->assertSame(
            $expectedCanRender,
            $plugin->afterCanRenderIcon($subject, false),
            $description
        );

        $html = $plugin->afterRenderIcon($subject, '<img id="logo">');

        $this->assertSame($expectExplainer, str_contains($html, 'tooltip-pay'), $description);
        $this->assertSame($expectLogo, str_contains($html, 'icon-pay'), $description);
    }

    /**
     * @return array<array{0:bool,1:bool,2:bool,3:bool,4:bool,5:string}>
     */
    public static function iconGateProvider(): array
    {
        return [
            [true, true, true, true, true, 'both shown when the brand links out and the theme shows icons'],
            [true, false, true, true, false, 'the explainer survives the theme hiding method icons'],
            [false, true, true, false, true, 'a brand with no about URL gets the logo alone'],
            [false, false, false, false, false, 'neither half, so the row is not rendered at all'],
        ];
    }

    /** An empty wrapper still occupies its padding and its share of the row. */
    public function testAWithheldHalfLeavesNoEmptyWrapper(): void
    {
        $plugin = $this->plugin(true, false, '<span id="explainer"></span>');
        $subject = new MethodMetaData(['additional_icon_provider' => ['template' => 'Two::t.phtml']]);

        $this->assertStringNotContainsString(
            "<div class='icon-pay inline-block'></div>",
            $plugin->afterRenderIcon($subject, '<img id="logo">')
        );
    }

    private function plugin(bool $aboutVisible, bool $iconsEnabled, string $blockHtml): MethodMetaDataPlugin
    {
        $layout = new Layout();
        $layout->blockHtml = $blockHtml;

        $systemConfigPayment = new SystemConfigPayment();
        $systemConfigPayment->displayMethodIcons = $iconsEnabled;

        $tileCopy = new class ($aboutVisible) extends CheckoutTileCopy {
            /** @var bool */
            private $visible;

            public function __construct(bool $visible)
            {
                $this->visible = $visible;
            }

            public function isAboutLinkVisible(): bool
            {
                return $this->visible;
            }
        };

        return new MethodMetaDataPlugin(
            $layout,
            $this->createMock(StoreManagerInterface::class),
            $systemConfigPayment,
            $tileCopy
        );
    }
}
