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
use Two\Gateway\Model\Config\Source\PaymentTermsType;
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
     * Given a chip click; When persistence fails or succeeds; Then every
     * repricing prices the term the session then names, and the session ends on
     * the term whose fee it holds.
     *
     * @param array<int, int> $expectedTermsPriced
     *
     * @dataProvider selectionProvider
     */
    public function testSelectTerm(
        int $failingSaves,
        array $expectedTermsPriced,
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
        $this->assertSame($expectedTermsPriced, $quote->termsPriced, "$because: terms priced, in order");
        $this->assertSame($expectedSessionTerm, $session->getTwoSelectedTerm(), "$because: session term");
    }

    /** @return array<string, array{int, array<int, int>, int, ?string, string}> */
    public static function selectionProvider(): array
    {
        $failed = 'Could not update payment term. Please try again.';

        return [
            'save succeeds' => [0, [60], 60, null, 'the buyer stays on the term they picked'],
            'save fails, rollback reprices' => [
                1,
                [60, 30],
                30,
                $failed,
                'the restored term is repriced, so the fee belongs to the term the order names',
            ],
            'rollback reprice fails too' => [
                2,
                [60, 30],
                60,
                $failed,
                'the session keeps the term whose fee it still holds, rather than crossing the two',
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
