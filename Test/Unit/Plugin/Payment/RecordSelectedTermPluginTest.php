<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\Plugin\Payment;

use Magento\Quote\Api\CartRepositoryInterface;
use Magento\Quote\Model\Quote;
use PHPUnit\Framework\TestCase;
use ReflectionClass;
use Two\Gateway\Service\Order\ChargedTermResolver;
use Two\GatewayHyva\Plugin\Payment\RecordSelectedTermPlugin;

/** ABN-556: the term placement composes the order from has to be the one the chip charged for. */
class RecordSelectedTermPluginTest extends TestCase
{
    /**
     * Given a charged term; When placement runs; Then the term is stated on the
     * quote payment and persisted, and nothing is written when no term is
     * charged at all.
     *
     * @dataProvider placementProvider
     */
    public function testPlacementRecordsTheChargedTerm(
        int $chargedTerm,
        ?int $expected,
        string $because
    ): void {
        $quote = (new Quote())->setStoreId(3);
        $repository = $this->recordingRepository();
        $resolver = new ChargedTermResolver();
        $resolver->resolved = $chargedTerm;

        (new RecordSelectedTermPlugin($repository, $resolver))
            ->beforePlaceOrder($this->placeOrderService(), $quote);

        $this->assertSame($expected, $quote->getPayment()->getAdditionalInformation()['selectedTerm'] ?? null, $because);
        $this->assertSame(
            $expected === null ? [] : [$expected],
            $repository->savedTerms,
            "$because: the recorded term must be persisted, not only set in memory",
        );
        $this->assertSame([3], $resolver->storeIds, "$because: resolved at the quote store, not the default scope");
    }

    /** @return array<int, array{int, ?int, string}> */
    public static function placementProvider(): array
    {
        return [
            [60, 60, 'an offered non-default choice is stated, not the default'],
            [0, null, 'with no term charged nothing is written onto the payment'],
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

    private function placeOrderService(): object
    {
        return (new ReflectionClass(\Two\GatewayHyva\Model\Magewire\Payment\PlaceOrderService::class))
            ->newInstanceWithoutConstructor();
    }
}
