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

        /**
         * TWO-26296: the basket key moves with every total the base prices an
         * order intent on, stays put when nothing moved, and carries no amount.
         *
         * @return array<string, array{array<string, mixed>, bool}>
         */
        public static function basketChanges(): array
        {
            return [
                'nothing moved' => [[], false],
                'shipping chosen' => [['shipping.getShippingAmount' => 15.0], true],
                'shipping method changed' => [['shipping.getShippingMethod' => 'other_rate'], true],
                'tax applied' => [['shipping.getTaxAmount' => 25.83], true],
                'virtual quote tax on billing' => [['billing.getTaxAmount' => 2.1], true],
                'grand total moved' => [['getGrandTotal' => 148.81], true],
                'quantity changed' => [['getItemsQty' => 4], true],
                'currency changed' => [['getQuoteCurrencyCode' => 'SEK'], true],
            ];
        }

        /**
         * @dataProvider basketChanges
         * @param array<string, mixed> $change
         */
        public function testTheBasketKeyFollowsTheTotals(array $change, bool $moves): void
        {
            $base = [
                'getQuoteCurrencyCode' => 'EUR',
                'getGrandTotal' => 107.98,
                'getItemsQty' => 3,
                'billing.getTaxAmount' => 0.0,
                'billing.getShippingAmount' => 0.0,
                'billing.getShippingMethod' => '',
                'shipping.getTaxAmount' => 0.0,
                'shipping.getShippingAmount' => 0.0,
                'shipping.getShippingMethod' => 'flat_rate',
            ];

            $before = $this->basketKey($base);
            $after = $this->basketKey(array_merge($base, $change));

            $this->assertSame($moves, $before !== $after, 'moves: ' . json_encode($change));
            $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $after, 'opaque: ' . json_encode($change));
        }

        /** @param array<string, mixed> $values */
        private function basketKey(array $values): string
        {
            $address = static function (string $role) use ($values): object {
                return new class ($role, $values) {
                    /** @var string */
                    private $role;
                    /** @var array<string, mixed> */
                    private $values;

                    public function __construct(string $role, array $values)
                    {
                        $this->role = $role;
                        $this->values = $values;
                    }

                    public function __call(string $name, array $arguments)
                    {
                        return $this->values[$this->role . '.' . $name] ?? null;
                    }
                };
            };
            $quote = new class ($values, $address('billing'), $address('shipping')) extends Quote {
                /** @var array<string, mixed> */
                private $values;
                /** @var object */
                private $billing;
                /** @var object */
                private $shipping;

                public function __construct(array $values, object $billing, object $shipping)
                {
                    $this->values = $values;
                    $this->billing = $billing;
                    $this->shipping = $shipping;
                }

                // A real method on the shared Quote stub, so __call never sees it.
                public function getQuoteCurrencyCode(): string
                {
                    return (string) ($this->values['getQuoteCurrencyCode'] ?? '');
                }

                public function __call(string $name, array $arguments)
                {
                    if ($name === 'getBillingAddress') {
                        return $this->billing;
                    }
                    if ($name === 'getShippingAddress') {
                        return $this->shipping;
                    }
                    return $this->values[$name] ?? null;
                }
            };
            $session = new Session();
            $session->setQuote($quote);

            $reflection = new ReflectionClass(GetQuoteDetails::class);
            $viewModel = $reflection->newInstanceWithoutConstructor();
            $reflection->getProperty('sessionCheckout')->setValue($viewModel, $session);

            return $viewModel->getIntentBasketKey();
        }
    }
}
