<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\Plugin\Payment;

use Magento\Checkout\Model\Session as CheckoutSession;
use Magento\Quote\Api\CartRepositoryInterface;
use Magento\Quote\Model\Quote;
use PHPUnit\Framework\TestCase;
use Two\GatewayHyva\Model\Magewire\Payment\PlaceOrderService;
use Two\GatewayHyva\Plugin\Payment\RecordSelectedTermPlugin;

/** ABN-621: the term the buyer chose has to reach the payment placement composes the order from. */
class RecordSelectedTermPluginTest extends TestCase
{
    /**
     * @dataProvider placementProvider
     * @param array<string, mixed> $existing
     */
    public function testPlacementRecordsTheChosenTerm(
        string $because,
        int $sessionTerm,
        array $existing,
        ?int $expected,
    ): void {
        $session = new CheckoutSession();
        $session->setTwoSelectedTerm($sessionTerm);
        $quote = new Quote();
        $quote->getPayment()->setAdditionalInformation($existing);
        $repository = $this->recordingRepository();

        (new RecordSelectedTermPlugin($repository, $session))
            ->beforePlaceOrder(new PlaceOrderService(), $quote);

        $recorded = $quote->getPayment()->getAdditionalInformation();
        $this->assertSame($expected, $recorded['selectedTerm'] ?? null, $because);
        $this->assertSame(
            $expected === null ? [] : [$expected],
            $repository->savedTerms,
            "$because: the recorded term must be persisted, not only set in memory",
        );
        foreach ($existing as $key => $value) {
            if ($key !== 'selectedTerm') {
                $this->assertSame($value, $recorded[$key] ?? null, "$because: tile field $key must survive");
            }
        }
    }

    /** @return array<string, array{string, int, array<string, mixed>, ?int}> */
    public static function placementProvider(): array
    {
        $tile = ['companyName' => 'Example Ltd', 'companyId' => '000000000'];

        return [
            'default term chosen' => ['the default chip, 30 days, is stated', 30, [], 30],
            'first non-default' => ['a 60 day choice reaches placement', 60, [], 60],
            'second non-default' => ['a 90 day choice reaches placement', 90, [], 90],
            'tile fields kept' => ['a choice is added to, not instead of, the tile fields', 90, $tile, 90],
            'stale payment term' => ['the live choice replaces an earlier recorded term', 60, ['selectedTerm' => 30], 60],
            'no choice made' => ['no chip click leaves the default to be priced and composed', 0, [], null],
        ];
    }

    /** @return CartRepositoryInterface&object{savedTerms: array<int, int|null>} */
    private function recordingRepository(): CartRepositoryInterface
    {
        return new class implements CartRepositoryInterface {
            /** @var array<int, int|null> */
            public array $savedTerms = [];

            public function save(Quote $quote): void
            {
                $this->savedTerms[] = $quote->getPayment()->getAdditionalInformation()['selectedTerm'] ?? null;
            }
        };
    }
}
