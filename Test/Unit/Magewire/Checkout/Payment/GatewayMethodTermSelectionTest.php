<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\Magewire\Checkout\Payment;

use Magento\Checkout\Model\Session;
use Magento\Framework\Exception\LocalizedException;
use Magento\Framework\Locale\ResolverInterface as LocaleResolver;
use Magento\Quote\Api\CartRepositoryInterface;
use Magento\Quote\Api\CartTotalRepositoryInterface;
use Magento\Quote\Model\Quote;
use PHPUnit\Framework\TestCase;
use Two\Gateway\Api\Config\RepositoryInterface as ConfigRepository;
use Two\Gateway\Api\Log\RepositoryInterface as LogRepository;
use Two\Gateway\Model\Config\Source\SurchargeType;
use Two\Gateway\Service\Order\TermSurchargePreview;
use Two\GatewayHyva\Magewire\Checkout\Payment\GatewayMethod;

/**
 * The surcharge is priced off the session term, so a chip click that cannot
 * persist must not leave the session naming one term while holding the fee of
 * another: the order composer compares the two and only refuses placement when
 * they disagree.
 */
class GatewayMethodTermSelectionTest extends TestCase
{
    /**
     * Given a chip click; When persistence fails or succeeds; Then the session
     * term and the buyer-facing message match the outcome.
     *
     * @dataProvider selectionProvider
     */
    public function testSelectTerm(
        int $failingSaves,
        int $expectedSessionTerm,
        ?string $expectedMessage,
        string $because
    ): void {
        $session = new Session();
        $session->setTwoSelectedTerm(30);
        $quote = $this->quoteObserving($session);
        $session->setQuote($quote);
        $repository = $this->repositoryFailing($failingSaves);

        $component = new GatewayMethod(
            $session,
            $repository,
            $this->cartTotalRepository(),
            $this->configRepository(),
            new TermSurchargePreview(),
            $this->logRepository(),
            $this->localeResolver(),
        );

        $message = null;
        try {
            $component->selectTerm(60);
        } catch (LocalizedException $e) {
            $message = $e->getMessage();
        }

        $this->assertSame($expectedMessage, $message, $because);
        $this->assertSame($expectedSessionTerm, $session->getTwoSelectedTerm(), "$because: session term");
    }

    /** @return array<string, array{int, int, ?string, string}> */
    public static function selectionProvider(): array
    {
        return [
            'save succeeds' => [0, 60, null, 'the buyer stays on the term they picked'],
            'save fails' => [
                1,
                30,
                'Could not update payment term. Please try again.',
                'a failed save returns the buyer to the previous term and says so',
            ],
        ];
    }

    /** Records the session term each repricing prices against. */
    private function quoteObserving(Session $session): Quote
    {
        $quote = new class extends Quote {
            public ?Session $session = null;

            /** @var array<int, int> */
            public array $termsPriced = [];

            public function collectTotals(): self
            {
                $this->termsPriced[] = $this->session->getTwoSelectedTerm();

                return $this;
            }
        };
        $quote->session = $session;
        $quote->setStoreId(3);

        return $quote;
    }

    private function repositoryFailing(int $failingSaves): CartRepositoryInterface
    {
        return new class ($failingSaves) implements CartRepositoryInterface {
            public int $saves = 0;

            public function __construct(private int $failingSaves)
            {
            }

            public function save(Quote $quote): void
            {
                $this->saves++;
                if ($this->saves <= $this->failingSaves) {
                    throw new \RuntimeException('quote save failed');
                }
            }
        };
    }

    private function configRepository(): ConfigRepository
    {
        return new class implements ConfigRepository {
            /** Mirrors the real repository, which answers with strings. */
            public function getAllBuyerTerms(?int $storeId = null): array
            {
                return ['30', '60'];
            }

            public function isCompanySearchEnabled(?int $storeId = null): bool
            {
                return false;
            }

            public function getSurchargeType(?int $storeId = null): string
            {
                return SurchargeType::NONE;
            }

            public function getSurchargeLineDescription(?int $storeId = null): string
            {
                return 'Payment terms fee';
            }

            public function getDefaultPaymentTerm(?int $storeId = null): int
            {
                return 30;
            }
        };
    }

    private function logRepository(): LogRepository
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

    private function localeResolver(): LocaleResolver
    {
        return new class implements LocaleResolver {
            public function getLocale()
            {
                return 'nl_NL';
            }
        };
    }

    private function cartTotalRepository(): CartTotalRepositoryInterface
    {
        return new class implements CartTotalRepositoryInterface {
            public function get($cartId)
            {
                return null;
            }
        };
    }
}
