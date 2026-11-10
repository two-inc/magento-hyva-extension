<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\Magewire\Checkout\Payment;

use Magento\Quote\Model\Quote;
use PHPUnit\Framework\TestCase;
use Two\GatewayHyva\Magewire\Checkout\Payment\GatewayMethod;

/**
 * TWO-27211: the chip fee is written by the store's own currency formatter,
 * as the order summary beside it is, never by the browser.
 */
class GatewayMethodChipFeeTextTest extends TestCase
{
    /**
     * @param array<int, int> $terms
     * @param array<int, float> $surcharges
     * @param array<int, string> $expected
     *
     * @dataProvider feeProvider
     */
    public function testFormatTermSurcharges(array $terms, array $surcharges, array $expected, string $because): void
    {
        $currency = new class {
            /** @var array<int, array{float, int, array<mixed>, bool}> */
            public array $calls = [];

            /** A store format no browser default produces. */
            public function formatPrecision($price, $precision, $options = [], $includeContainer = true)
            {
                $this->calls[] = [$price, $precision, $options, $includeContainer];

                return number_format((float) $price, $precision, ',', '.') . ' EUR';
            }
        };
        $quote = new class ($currency) extends Quote {
            public function __construct(private object $currency)
            {
            }

            public function getStore(): object
            {
                $currency = $this->currency;

                return new class ($currency) {
                    public function __construct(private object $currency)
                    {
                    }

                    public function getCurrentCurrency(): object
                    {
                        return $this->currency;
                    }
                };
            }
        };

        $component = (new \ReflectionClass(GatewayMethod::class))->newInstanceWithoutConstructor();
        $method = new \ReflectionMethod(GatewayMethod::class, 'formatTermSurcharges');
        $method->setAccessible(true);

        $this->assertSame($expected, $method->invoke($component, $quote, $terms, $surcharges), $because);
        foreach ($currency->calls as $call) {
            $this->assertSame(false, $call[3], "$because: no price container markup in a chip");
        }
    }

    /** @return array<string, array{array<int, int>, array<int, float>, array<int, string>, string}> */
    public static function feeProvider(): array
    {
        return [
            'priced set' => [[30, 60], [30 => 12.5, 60 => 1234.0], [30 => '12,50 EUR', 60 => '1.234,00 EUR'], 'each term in the store format'],
            'unanswered term' => [[30, 60], [30 => 12.5], [30 => '12,50 EUR', 60 => '0,00 EUR'], 'a term the map lacks reads as a formatted zero'],
            'no fees loaded' => [[30, 60], [], [], 'nothing to show while the fee map is empty'],
        ];
    }
}
