<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\ViewModel;

use Magento\Checkout\Model\Session;
use Magento\Quote\Model\Quote;
use PHPUnit\Framework\TestCase;
use ReflectionClass;
use Two\GatewayHyva\ViewModel\GetQuoteDetails;

/**
 * TWO-26295: the quote's countries as they are now, for the tile to read in
 * place of its page-load snapshot.
 */
class GetQuoteDetailsLiveCountriesTest extends TestCase
{
    /**
     * @dataProvider cases
     */
    public function testLiveCountries(?string $billing, ?string $shipping, array $expected, string $description): void
    {
        $address = static function (?string $country): ?object {
            return $country === null ? null : new class ($country) {
                /** @var string */
                private $country;

                public function __construct(string $country)
                {
                    $this->country = $country;
                }

                public function getCountryId(): string
                {
                    return $this->country;
                }
            };
        };
        $quote = new class ($address($billing), $address($shipping)) extends Quote {
            /** @var ?object */
            private $billing;
            /** @var ?object */
            private $shipping;

            public function __construct(?object $billing, ?object $shipping)
            {
                $this->billing = $billing;
                $this->shipping = $shipping;
            }

            public function __call(string $name, array $arguments)
            {
                return ['getBillingAddress' => $this->billing, 'getShippingAddress' => $this->shipping][$name] ?? null;
            }
        };
        $session = new Session();
        $session->setQuote($quote);

        $reflection = new ReflectionClass(GetQuoteDetails::class);
        $viewModel = $reflection->newInstanceWithoutConstructor();
        $reflection->getProperty('sessionCheckout')->setValue($viewModel, $session);

        $this->assertSame($expected, $viewModel->getLiveAddressCountries(), $description);
    }

    public static function cases(): array
    {
        return [
            ['ES', 'US', ['billing' => 'ES', 'shipping' => 'US'], 'both addresses report their own country'],
            ['ES', null, ['billing' => 'ES', 'shipping' => ''], 'no shipping address (virtual quote)'],
            [null, null, ['billing' => '', 'shipping' => ''], 'no addresses yet'],
        ];
    }
}
