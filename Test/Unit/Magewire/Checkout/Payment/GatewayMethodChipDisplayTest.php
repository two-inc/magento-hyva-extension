<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\Magewire\Checkout\Payment;

use PHPUnit\Framework\TestCase;
use Two\Gateway\Service\Order\SurchargeDisplay;
use Two\GatewayHyva\Magewire\Checkout\Payment\GatewayMethod;

/**
 * The chip preview amount must follow the same `tax/cart_display/price`
 * resolution as the order-summary segment for excl/incl, but stays net in
 * "both" mode by deliberate product decision (contrasting with the
 * summary's two rows there) — see resolveDisplayAmount()'s docblock.
 *
 * Regression coverage for the chip silently staying net in "incl" mode
 * (magento-hyva-extension#129 follow-up): nothing previously exercised
 * GatewayMethod's mode resolution at all.
 */
class GatewayMethodChipDisplayTest extends TestCase
{
    /**
     * @return array<string, array{0: string, 1: float, 2: float, 3: float, 4: string}>
     */
    public static function modeProvider(): array
    {
        return [
            'excl mode shows net' => [SurchargeDisplay::EXCL, 100.0, 125.0, 100.0, 'excl must show net'],
            'incl mode shows gross' => [SurchargeDisplay::INCL, 100.0, 125.0, 125.0, 'incl must show gross'],
            'both mode shows net' => [
                SurchargeDisplay::BOTH,
                100.0,
                125.0,
                100.0,
                'both is a deliberate chip/summary divergence, not a bug',
            ],
        ];
    }

    /**
     * @dataProvider modeProvider
     */
    public function testResolveDisplayAmount(string $mode, float $net, float $gross, float $expected, string $because): void
    {
        $instance = (new \ReflectionClass(GatewayMethod::class))->newInstanceWithoutConstructor();
        $method = new \ReflectionMethod(GatewayMethod::class, 'resolveDisplayAmount');
        $method->setAccessible(true);

        $this->assertSame($expected, $method->invoke($instance, $mode, $net, $gross), $because);
    }

    /**
     * Structural guard alongside the behavioural one above: computeAllTermSurcharges
     * must resolve its display mode from TermSurchargePreview::taxDisplay() and route
     * through resolveDisplayAmount(), not read $entry['net'] directly — that's exactly
     * how this bug shipped (always net, mode never consulted).
     */
    public function testComputeAllTermSurchargesConsultsDisplayModeForEachTerm(): void
    {
        $source = (string) file_get_contents(
            __DIR__ . '/../../../../../Magewire/Checkout/Payment/GatewayMethod.php'
        );
        $bodyStart = strpos($source, 'private function computeAllTermSurcharges');
        $this->assertNotFalse($bodyStart, 'computeAllTermSurcharges must exist');
        $nextMethod = strpos($source, 'private function resolveDisplayAmount');
        $this->assertNotFalse($nextMethod, 'resolveDisplayAmount must exist');
        $body = substr($source, $bodyStart, $nextMethod - $bodyStart);

        $this->assertStringContainsString('->taxDisplay(', $body);
        $this->assertStringContainsString('->resolveDisplayAmount(', $body);
        $this->assertStringNotContainsString("\$entry['net'];", $body);
    }
}
