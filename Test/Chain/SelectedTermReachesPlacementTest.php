<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Chain;

use Magento\Checkout\Model\Session;
use Magento\Framework\Exception\LocalizedException;
use Magento\Framework\Locale\ResolverInterface as LocaleResolver;
use Magento\Quote\Api\CartRepositoryInterface;
use Magento\Quote\Api\CartTotalRepositoryInterface;
use Magento\Quote\Model\Quote;
use PHPUnit\Framework\TestCase;
use ReflectionClass;
use Two\Gateway\Api\Config\RepositoryInterface as ConfigRepository;
use Two\Gateway\Api\Log\RepositoryInterface as LogRepository;
use Two\Gateway\Model\Config\Source\PaymentTermsType;
use Two\Gateway\Model\Config\Source\SurchargeType;
use Two\Gateway\Service\Order\ChargedTermResolver;
use Two\Gateway\Service\Order\TermSurchargePreview;
use Two\GatewayHyva\Magewire\Checkout\Payment\GatewayMethod;
use Two\GatewayHyva\Model\Magewire\Payment\PlaceOrderService;

/**
 * ABN-621: the term the buyer chose has to be the term placement hands the base
 * module. In 2.0.x the choice reached the session and the surcharge but never
 * the quote payment, so the order was composed on the merchant default.
 *
 * This runs the chain a buyer's clicks drive, with nothing between the chip and
 * the payment replaced by a double that answers what it is told (the framework
 * edges aside, see below):
 *
 *  - the payment tile's Magewire component (boot, term selection, payment data),
 *  - the plugins registered in etc/frontend/di.xml on the placement service, in
 *    their registered order (so a deleted or re-ordered registration fails),
 *  - the base module's REAL charged-term resolver (see bootstrap-chain.php).
 *
 * Only the framework edges are stubs or fakes: the quote, its payment and the
 * checkout session (bootstrap stubs), the config repository and the cart
 * repository. The assertion is on the payment's additional
 * information, the place the base module's order composer reads the term from.
 * Composing the order itself needs the Magento framework, which this suite does
 * not load; the composer refuses a term that disagrees with the session's, so the
 * stamped term is also checked against the session term wherever one was chosen.
 */
class SelectedTermReachesPlacementTest extends TestCase
{
    private const PLACE_ORDER_SERVICE = PlaceOrderService::class;
    private const STORE_ID = 3;
    private const PAYMENT_FORM = ['poNumber' => 'PO-7', 'companyId' => '12345678'];

    /**
     * Given a merchant offering 30, 60 and 90 days with 30 as the default; When
     * the buyer's clicks run through to placement in the given order; Then the
     * payment states the term the buyer ended on, or placement is refused.
     *
     * Steps: select N = chip click, pay = the tile saves its form to the payment,
     * withdraw N = the merchant stops offering N, place = placement.
     *
     * @param array<int, array{string, int}> $steps
     *
     * @dataProvider journeyProvider
     */
    public function testSelectedTermIsStatedAtPlacement(
        array $steps,
        ?int $expectedTerm,
        ?string $expectedRefusal,
        string $because
    ): void {
        $world = $this->world();

        $refusal = null;
        try {
            foreach ($steps as [$step, $days]) {
                $this->perform($world, $step, $days);
            }
        } catch (LocalizedException $e) {
            $refusal = $e->getMessage();
        }

        $info = $world['quote']->getPayment()->getAdditionalInformation();
        $this->assertSame($expectedRefusal, $refusal, "$because: placement outcome");
        $this->assertSame($expectedTerm, $info['selectedTerm'] ?? null, "$because: term on the payment");
        if ($expectedTerm !== null) {
            $sessionTerm = $world['session']->getTwoSelectedTerm();
            if ($sessionTerm > 0) {
                // The composer refuses a stated term that disagrees with the session's.
                $this->assertSame($expectedTerm, $sessionTerm, "$because: the stated term agrees with the session term");
            }
            $this->assertSame(
                self::PAYMENT_FORM['poNumber'],
                $info['poNumber'] ?? null,
                "$because: stating the term must not wipe the saved payment form",
            );
            $this->assertSame([$expectedTerm], array_slice($world['repository']->savedTerms, -1), "$because: persisted");
        }
    }

    /** @return array<string, array{array<int, array{string, int}>, ?int, ?string, string}> */
    public static function journeyProvider(): array
    {
        $gone = 'The selected payment term is no longer available. Please review the payment options and place the order again.';

        return [
            'default, no chip clicked (control)' => [
                [['pay', 0], ['place', 0]], 30, null,
                'with no choice the merchant default is stated',
            ],
            'default chip clicked' => [
                [['select', 30], ['pay', 0], ['place', 0]], 30, null,
                'an explicit default choice is stated as the default',
            ],
            'non-default 60' => [
                [['select', 60], ['pay', 0], ['place', 0]], 60, null,
                'a non-default choice must reach the payment, not fall back to 30',
            ],
            'non-default 90' => [
                [['select', 90], ['pay', 0], ['place', 0]], 90, null,
                'the longest offered term must reach the payment, not fall back to 30',
            ],
            'changed before the form was saved' => [
                [['select', 60], ['select', 90], ['pay', 0], ['place', 0]], 90, null,
                'the last choice wins',
            ],
            'changed AFTER the form was saved' => [
                [['select', 60], ['pay', 0], ['select', 90], ['place', 0]], 90, null,
                'a chip clicked after the payment data was saved must still be the term stated',
            ],
            'reverted to default after the form was saved' => [
                [['select', 90], ['pay', 0], ['select', 30], ['place', 0]], 30, null,
                'going back to the default after a non-default choice states the default',
            ],
            'placed again on a different term, form not re-saved' => [
                [['select', 90], ['pay', 0], ['place', 0], ['select', 60], ['place', 0]], 60, null,
                'a stamp left by the first attempt is re-derived at the retry, not trusted',
            ],
            'placed again on a different term, form re-saved' => [
                [['select', 90], ['pay', 0], ['place', 0], ['select', 60], ['pay', 0], ['place', 0]], 60, null,
                'the retry states the term chosen since the first attempt',
            ],
            'term withdrawn by the merchant' => [
                [['select', 90], ['pay', 0], ['withdraw', 90], ['place', 0]], null, $gone,
                'a withdrawn term is refused at placement and never stated on the payment',
            ],
        ];
    }

    /**
     * @param array<string, mixed> $world
     */
    private function perform(array $world, string $step, int $days): void
    {
        /** @var GatewayMethod $tile */
        $tile = $world['tile'];
        // Magewire boots the component on every round trip before the call.
        $tile->boot();

        match ($step) {
            'select' => $tile->selectTerm($days),
            'pay' => $tile->setPaymentData(['additionalData' => self::PAYMENT_FORM]),
            'withdraw' => $world['config']->withdraw($days),
            'place' => $this->place($world),
        };
    }

    /**
     * What Magento's interceptor does for the placement service: every registered
     * before-plugin in sortOrder, then the method itself. Read from di.xml so the
     * registration is part of what is under test.
     *
     * @param array<string, mixed> $world
     */
    private function place(array $world): void
    {
        $service = (new ReflectionClass(self::PLACE_ORDER_SERVICE))->newInstanceWithoutConstructor();
        foreach ($this->registeredPlugins() as $class) {
            $plugin = $this->instantiate($class, $world);
            $plugin->beforePlaceOrder($service, $world['quote']);
        }
        $service->placeOrder($world['quote']);
    }

    /** @return array<int, class-string> plugin classes on the placement service, in execution order */
    private function registeredPlugins(): array
    {
        $di = simplexml_load_file(__DIR__ . '/../../etc/frontend/di.xml');
        $plugins = [];
        foreach ($di->xpath('//type[@name="' . self::PLACE_ORDER_SERVICE . '"]/plugin') ?: [] as $plugin) {
            if ((string) ($plugin['disabled'] ?? '') === 'true') {
                continue;
            }
            $plugins[] = [(int) $plugin['sortOrder'], (string) $plugin['type']];
        }
        usort($plugins, static fn (array $a, array $b): int => $a[0] <=> $b[0]);

        return array_column($plugins, 1);
    }

    /**
     * Builds a plugin the way the object manager would, from the world's
     * collaborators by type. A dependency the world cannot supply fails loudly
     * rather than being papered over.
     *
     * @param class-string         $class
     * @param array<string, mixed> $world
     */
    private function instantiate(string $class, array $world): object
    {
        $byType = [
            Session::class => $world['session'],
            ConfigRepository::class => $world['config'],
            CartRepositoryInterface::class => $world['repository'],
            ChargedTermResolver::class => new ChargedTermResolver($world['session'], $world['config']),
        ];
        $args = [];
        foreach ((new ReflectionClass($class))->getConstructor()?->getParameters() ?? [] as $parameter) {
            $type = $parameter->getType()?->getName();
            $this->assertArrayHasKey($type, $byType, "$class needs $type, which this chain does not provide");
            $args[] = $byType[$type];
        }

        return new $class(...$args);
    }

    /** @return array<string, mixed> */
    private function world(): array
    {
        $session = new Session();
        $quote = (new Quote())->setStoreId(self::STORE_ID);
        $session->setQuote($quote);
        $repository = $this->cartRepository();
        $config = $this->config();

        return [
            'session' => $session,
            'quote' => $quote,
            'repository' => $repository,
            'config' => $config,
            'tile' => new GatewayMethod(
                $session,
                $repository,
                $this->cartTotals(),
                $config,
                new TermSurchargePreview(),
                $this->logs(),
                $this->locale(),
            ),
        ];
    }

    /** Records the term on the payment at every save. */
    private function cartRepository(): CartRepositoryInterface
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

    /** Offers 30, 60 and 90 with 30 as the default; terms can be withdrawn. */
    private function config(): ConfigRepository
    {
        return new class implements ConfigRepository {
            /** @var array<int, int> */
            private array $offered = [30, 60, 90];

            public function withdraw(int $days): void
            {
                $this->offered = array_values(array_diff($this->offered, [$days]));
            }

            /** Answers with strings, like the real repository. */
            public function getAllBuyerTerms(?int $storeId = null): array
            {
                return array_map('strval', $this->offered);
            }

            public function isBuyerTermAvailable(int $days, ?int $storeId = null): bool
            {
                return in_array($days, $this->offered, true);
            }

            public function getDefaultPaymentTerm(?int $storeId = null): int
            {
                return 30;
            }

            public function isCompanySearchEnabled(?int $storeId = null): bool
            {
                return false;
            }

            public function getPaymentTermsType(?int $storeId = null): string
            {
                return PaymentTermsType::STANDARD;
            }

            public function getSurchargeType(?int $storeId = null): string
            {
                return SurchargeType::NONE;
            }

            public function getSurchargeLineDescription(?int $storeId = null): string
            {
                return 'Payment terms fee';
            }
        };
    }

    private function logs(): LogRepository
    {
        return new class implements LogRepository {
            public function addDebugLog($title, $data)
            {
            }

            public function addErrorLog($title, $data)
            {
            }
        };
    }

    private function locale(): LocaleResolver
    {
        return new class implements LocaleResolver {
            public function getLocale()
            {
                return 'nl_NL';
            }
        };
    }

    private function cartTotals(): CartTotalRepositoryInterface
    {
        return new class implements CartTotalRepositoryInterface {
            public function get($cartId)
            {
                return null;
            }
        };
    }
}
