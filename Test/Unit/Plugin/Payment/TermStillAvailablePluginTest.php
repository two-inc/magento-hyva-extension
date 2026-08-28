<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\Plugin\Payment;

use Magento\Checkout\Model\Session as CheckoutSession;
use Magento\Framework\Exception\LocalizedException;
use Magento\Quote\Api\CartManagementInterface;
use Magento\Quote\Model\Quote;
use PHPUnit\Framework\TestCase;
use Two\Gateway\Api\Config\RepositoryInterface as ConfigRepository;
use Two\GatewayHyva\Model\Magewire\Payment\PlaceOrderService;
use Two\GatewayHyva\Plugin\Payment\TermStillAvailablePlugin;

class TermStillAvailablePluginTest extends TestCase
{
    /**
     * @dataProvider termAvailabilityProvider
     * @param int[] $offeredTerms
     */
    public function testBeforePlaceOrder(
        int $selectedTerm,
        array $offeredTerms,
        bool $expectException,
        string $because,
    ): void {
        $checkoutSession = new CheckoutSession();
        $checkoutSession->setTwoSelectedTerm($selectedTerm);

        $configRepository = new class ($offeredTerms) implements ConfigRepository {
            /** @param int[] $offeredTerms */
            public function __construct(private array $offeredTerms)
            {
            }

            public function getAllBuyerTerms(?int $storeId = null): array
            {
                return $this->offeredTerms;
            }
        };

        $plugin = new TermStillAvailablePlugin($checkoutSession, $configRepository);
        $subject = new PlaceOrderService(new class implements CartManagementInterface {
        });

        if (!$expectException) {
            $plugin->beforePlaceOrder($subject, new Quote());
            $this->addToAssertionCount(1);
            return;
        }

        // A `before` plugin that throws stops Magento's interceptor chain
        // before the real placeOrder() runs — asserting the throw here IS
        // asserting no order gets placed and no order id comes back.
        try {
            $plugin->beforePlaceOrder($subject, new Quote());
            $this->fail("$because: expected LocalizedException, none thrown");
        } catch (LocalizedException $e) {
            $this->assertStringContainsString('no longer available', (string) $e->getMessage(), $because);
        }
    }

    /** @return array<string, array{int, int[], bool, string}> */
    public static function termAvailabilityProvider(): array
    {
        return [
            'no term selected' => [0, [14, 30, 60], false, 'nothing chosen yet — nothing to re-check'],
            'selected term still offered' => [30, [14, 30, 60], false, 'term unchanged — order proceeds normally'],
            'selected term withdrawn' => [30, [14, 60], true, 'term removed between render and submit — must block'],
            'offered set empty (cold cache)' => [30, [], false, 'fail-open, mirrors WC_Twoinc::process_payment()'],
        ];
    }
}
