<?php

declare(strict_types=1);

namespace Magento\Store\Model {
    if (!interface_exists(ScopeInterface::class, false)) {
        interface ScopeInterface
        {
            public const SCOPE_STORE = 'store';
        }
    }
}

namespace Two\GatewayHyva\Test\Unit\ViewModel {

    use Magento\Checkout\Model\Session;
    use Magento\Quote\Model\Quote;
    use PHPUnit\Framework\TestCase;
    use ReflectionClass;
    use Two\GatewayHyva\ViewModel\GetQuoteDetails;

    /**
     * Order intent's amounts and lines are composed server-side by the base
     * module (TWO-26092), so the page carries only the quote id, contact and
     * country fields the templates still read.
     */
    class GetQuoteDetailsTest extends TestCase
    {
        public function testThePageCarriesNoAmountsOrLines(): void
        {
            $address = new class {
                public function __call(string $name, array $arguments)
                {
                    return $name === 'getCountryId' ? 'GB' : 'x';
                }
            };
            $quote = new class ($address) extends Quote {
                /** @var object */
                private $address;

                public function __construct(object $address)
                {
                    $this->address = $address;
                }

                public function __call(string $name, array $arguments)
                {
                    if (in_array($name, ['getBillingAddress', 'getShippingAddress'], true)) {
                        return $this->address;
                    }
                    return ['getId' => 7, 'getItems' => [], 'getTotals' => []][$name] ?? 'x';
                }
            };
            $session = new Session();
            $session->setQuote($quote);
            $scopeConfig = new class implements \Magento\Framework\App\Config\ScopeConfigInterface {
                public function getValue($path, $scope = 'default', $scopeCode = null)
                {
                    return 'NO';
                }
            };

            $reflection = new ReflectionClass(GetQuoteDetails::class);
            $viewModel = $reflection->newInstanceWithoutConstructor();
            $reflection->getProperty('sessionCheckout')->setValue($viewModel, $session);
            $reflection->getProperty('scopeConfig')->setValue($viewModel, $scopeConfig);

            $this->assertSame(
                [
                    'quote_id',
                    'email',
                    'telephone',
                    'country_id',
                    'billing_country_id',
                    'first_name',
                    'last_name',
                    'shipping_country_id',
                    'default_country_id',
                ],
                array_keys($viewModel->getQuoteDetails())
            );
        }
    }
}
