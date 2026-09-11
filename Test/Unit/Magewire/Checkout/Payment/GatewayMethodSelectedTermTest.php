<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\Magewire\Checkout\Payment;

use Magento\Checkout\Model\Session as CheckoutSession;
use Magento\Quote\Api\CartRepositoryInterface;
use Magento\Quote\Model\Quote;
use PHPUnit\Framework\TestCase;
use ReflectionClass;
use ReflectionMethod;
use Two\Gateway\Service\Order\ChargedTermResolver;
use Two\GatewayHyva\Magewire\Checkout\Payment\GatewayMethod;
use Two\GatewayHyva\Plugin\Payment\RecordSelectedTermPlugin;

/** ABN-556: the term placement composes the order from has to be the one the chip charged for. */
class GatewayMethodSelectedTermTest extends TestCase
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

    /**
     * Given the tile sends its payload; When it is stored; Then the charged term
     * travels with the tile fields rather than replacing them.
     */
    public function testSetPaymentDataRecordsTheChargedTermBesideTheTileFields(): void
    {
        $session = new CheckoutSession();
        $quote = (new Quote())->setStoreId(7);
        $session->setQuote($quote);
        $resolver = new ChargedTermResolver();
        $resolver->resolved = 60;

        $component = (new ReflectionClass(GatewayMethod::class))->newInstanceWithoutConstructor();
        $this->assign($component, 'checkoutSession', $session);
        $this->assign($component, 'quoteRepository', $this->recordingRepository());
        $this->assign($component, 'chargedTerm', $resolver);
        $component->setPaymentData(['additionalData' => ['companyName' => 'Example Ltd', 'companyId' => '000000000']]);

        $recorded = $quote->getPayment()->getAdditionalInformation();
        $this->assertSame(60, $recorded['selectedTerm'] ?? null, 'the chip choice must reach placement');
        $this->assertSame('Example Ltd', $recorded['companyName'] ?? null, 'the tile fields must survive');
        $this->assertSame('000000000', $recorded['companyId'] ?? null, 'the tile fields must survive');
        $this->assertSame([7], $resolver->storeIds, 'the term must be resolved at the quote store');
    }

    /**
     * The brand overlay subclasses this component and forwards eight positional
     * constructor arguments, the last being the method code. A dependency
     * inserted ahead of it lands in the wrong parameter and the payment tile
     * stops constructing.
     */
    public function testTheConstructorStaysPositionallyCompatibleWithTheBrandOverlay(): void
    {
        $parameters = (new ReflectionMethod(GatewayMethod::class, '__construct'))->getParameters();

        $this->assertSame('methodCode', $parameters[7]->getName());
        $this->assertTrue($parameters[7]->isDefaultValueAvailable());
    }

    /** A component the overlay constructed still resolves a term of its own. */
    public function testAComponentBuiltWithoutAResolverMakesOne(): void
    {
        $component = (new ReflectionClass(GatewayMethod::class))->newInstanceWithoutConstructor();
        $this->assign($component, 'checkoutSession', new CheckoutSession());
        $this->assign($component, 'configRepository', $this->configRepository());
        $this->assign($component, 'chargedTerm', null);

        $resolve = new ReflectionMethod(GatewayMethod::class, 'chargedTerm');
        $resolve->setAccessible(true);

        $this->assertInstanceOf(ChargedTermResolver::class, $resolve->invoke($component));
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

    private function configRepository(): object
    {
        return new class implements \Two\Gateway\Api\Config\RepositoryInterface {
            /** @return int[] */
            public function getAllBuyerTerms(?int $storeId = null): array
            {
                return [];
            }

            public function isCompanySearchEnabled(?int $storeId = null): bool
            {
                return true;
            }
        };
    }

    private function placeOrderService(): object
    {
        return (new ReflectionClass(\Two\GatewayHyva\Model\Magewire\Payment\PlaceOrderService::class))
            ->newInstanceWithoutConstructor();
    }

    private function assign(object $target, string $property, $value): void
    {
        $reflected = new \ReflectionProperty($target, $property);
        $reflected->setAccessible(true);
        $reflected->setValue($target, $value);
    }
}
