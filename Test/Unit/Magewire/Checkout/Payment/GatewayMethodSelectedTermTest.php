<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\Magewire\Checkout\Payment;

use Magento\Checkout\Model\Session as CheckoutSession;
use Magento\Quote\Api\CartRepositoryInterface;
use Magento\Quote\Model\Quote;
use PHPUnit\Framework\TestCase;
use Two\Gateway\Api\Config\RepositoryInterface as ConfigRepository;
use Two\GatewayHyva\Magewire\Checkout\Payment\GatewayMethod;
use Two\GatewayHyva\Plugin\Payment\RecordSelectedTermPlugin;
use Two\GatewayHyva\Service\ChargedTerm;

/** ABN-556: the term placement composes the order from has to be the one the chip charged for. */
class GatewayMethodSelectedTermTest extends TestCase
{
    /**
     * @dataProvider chargedTermProvider
     * @param int[] $offered
     */
    public function testChargedTermResolution(
        string $because,
        int $sessionTerm,
        array $offered,
        ?int $defaultTerm,
        int $expected,
    ): void {
        $session = new CheckoutSession();
        $session->setTwoSelectedTerm($sessionTerm);

        $resolved = (new ChargedTerm($session, $this->configRepository($defaultTerm, $offered)))->resolve(3);

        $this->assertSame($expected, $resolved, $because);
    }

    /** @return array<int, array{string, int, int[], ?int, int}> */
    public static function chargedTermProvider(): array
    {
        return [
            ['the chip choice is charged', 90, [30, 60, 90], 30, 90],
            ['an offered non-default choice is charged, not the default', 60, [30, 60], 30, 60],
            ['no choice leaves the configured default charged', 0, [30, 60, 90], 30, 30],
            ['a term the merchant withdrew is not charged', 45, [30, 60, 90], 30, 30],
            ['nothing offered leaves no term to charge', 90, [], null, 0],
        ];
    }

    /**
     * @dataProvider placementProvider
     * @param int[] $offered
     */
    public function testPlacementRecordsTheChargedTerm(
        string $because,
        int $sessionTerm,
        array $offered,
        ?int $defaultTerm,
        ?int $expected,
    ): void {
        $session = new CheckoutSession();
        $session->setTwoSelectedTerm($sessionTerm);
        $quote = (new Quote())->setStoreId(3);
        $repository = $this->recordingRepository();

        $plugin = new RecordSelectedTermPlugin(
            $repository,
            new ChargedTerm($session, $this->configRepository($defaultTerm, $offered)),
        );
        $plugin->beforePlaceOrder($this->placeOrderService(), $quote);

        $this->assertSame($expected, $quote->getPayment()->getAdditionalInformation()['selectedTerm'] ?? null, $because);
        $this->assertSame(
            $expected === null ? [] : [$expected],
            $repository->savedTerms,
            "$because: the recorded term must be persisted, not only set in memory",
        );
    }

    /** @return array<int, array{string, int, int[], ?int, ?int}> */
    public static function placementProvider(): array
    {
        return [
            ['the term is stated at placement, whatever the tile sent earlier', 90, [30, 60, 90], 30, 90],
            ['an offered non-default choice is stated, not the default', 60, [30, 60], 30, 60],
            ['a withdrawn choice states the default the surcharge was priced on', 45, [30, 60, 90], 30, 30],
            ['with no term to state nothing is written onto the payment', 90, [], null, null],
        ];
    }

    /**
     * The tile's own payload keeps carrying the term as well, so a placement
     * through a host that rebuilds the payment from it is unaffected.
     */
    public function testSetPaymentDataRecordsTheChargedTermBesideTheTileFields(): void
    {
        $session = new CheckoutSession();
        $session->setTwoSelectedTerm(60);
        $quote = (new Quote())->setStoreId(7);
        $session->setQuote($quote);
        $config = $this->configRepository(30, [30, 60, 90]);

        $component = (new \ReflectionClass(GatewayMethod::class))->newInstanceWithoutConstructor();
        $this->assign($component, 'checkoutSession', $session);
        $this->assign($component, 'quoteRepository', $this->recordingRepository());
        $this->assign($component, 'chargedTerm', new ChargedTerm($session, $config));
        $component->setPaymentData(['additionalData' => ['companyName' => 'Example Ltd', 'companyId' => '000000000']]);

        $recorded = $quote->getPayment()->getAdditionalInformation();
        $this->assertSame(60, $recorded['selectedTerm'] ?? null, 'the chip choice must reach placement');
        $this->assertSame('Example Ltd', $recorded['companyName'] ?? null, 'the tile fields must survive');
        $this->assertSame('000000000', $recorded['companyId'] ?? null, 'the tile fields must survive');
        $this->assertSame([7], $config->storeIds, 'the term must be resolved at the quote store, not the default scope');
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

    /**
     * @param int[] $offered
     * @return ConfigRepository&object{storeIds: array<int, ?int>}
     */
    private function configRepository(?int $defaultTerm, array $offered): ConfigRepository
    {
        return new class ($defaultTerm, $offered) implements ConfigRepository {
            /** @var array<int, ?int> every store id the resolution asked about */
            public array $storeIds = [];

            /** @param int[] $offered */
            public function __construct(private ?int $defaultTerm, private array $offered)
            {
            }

            public function getDefaultPaymentTerm(?int $storeId = null): ?int
            {
                $this->storeIds[] = $storeId;
                return $this->defaultTerm;
            }

            public function isCompanySearchEnabled(?int $storeId = null): bool
            {
                return true;
            }

            /** @return int[] */
            public function getAllBuyerTerms(?int $storeId = null): array
            {
                $this->storeIds[] = $storeId;
                return $this->offered;
            }

            public function isBuyerTermAvailable(int $termDays, ?int $storeId = null): bool
            {
                $this->storeIds[] = $storeId;
                return in_array($termDays, $this->offered, true);
            }
        };
    }

    private function placeOrderService(): object
    {
        return (new \ReflectionClass(\Two\GatewayHyva\Model\Magewire\Payment\PlaceOrderService::class))
            ->newInstanceWithoutConstructor();
    }

    private function assign(GatewayMethod $component, string $property, object $value): void
    {
        $reflected = new \ReflectionProperty(GatewayMethod::class, $property);
        $reflected->setAccessible(true);
        $reflected->setValue($component, $value);
    }
}
