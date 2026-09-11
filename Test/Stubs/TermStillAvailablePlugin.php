<?php

declare(strict_types=1);

// Minimal stubs of the Magento/Hyva quote, session and placement types the
// term-selection suites exercise. Only the surface the code under test
// actually calls is stubbed — see Test/bootstrap.php for the convention.

namespace Magento\Quote\Api {
    if (!interface_exists(CartManagementInterface::class, false)) {
        interface CartManagementInterface
        {
        }
    }
}

namespace Hyva\Checkout\Model\Magewire\OrderData {
    if (!class_exists(AbstractOrderData::class, false)) {
        abstract class AbstractOrderData
        {
        }
    }
}

namespace Magento\Quote\Model\Quote {
    if (!class_exists(Payment::class, false)) {
        class Payment
        {
            /** @var array<string, mixed> */
            private array $additionalInformation = [];

            /**
             * Magento's own signature: one key with the two-argument form,
             * the whole array with the one-argument form.
             *
             * @param array<string, mixed>|string $information
             */
            public function setAdditionalInformation($information, $value = null): self
            {
                if (is_array($information)) {
                    $this->additionalInformation = $information;
                    return $this;
                }
                $this->additionalInformation[$information] = $value;
                return $this;
            }

            /** @return array<string, mixed> */
            public function getAdditionalInformation(): array
            {
                return $this->additionalInformation;
            }
        }
    }
}

namespace Magento\Quote\Model {
    use Magento\Quote\Model\Quote\Payment;

    if (!class_exists(Quote::class, false)) {
        class Quote
        {
            private int $storeId = 0;

            private ?Payment $payment = null;

            public function getStoreId(): int
            {
                return $this->storeId;
            }

            public function setStoreId(int $storeId): self
            {
                $this->storeId = $storeId;
                return $this;
            }

            public function getPayment(): Payment
            {
                if ($this->payment === null) {
                    $this->payment = new Payment();
                }
                return $this->payment;
            }

            public function setPayment(Payment $payment): self
            {
                $this->payment = $payment;
                return $this;
            }
        }
    }
}

namespace Magento\Quote\Api {
    use Magento\Quote\Model\Quote;

    if (!interface_exists(CartRepositoryInterface::class, false)) {
        interface CartRepositoryInterface
        {
            public function save(Quote $quote): void;
        }
    }
}

// Magento\Framework\Phrase and the global __() are stubbed in
// MagentoTranslate.php, required before this file — see Test/bootstrap.php.

namespace Magento\Framework\Exception {
    if (!class_exists(LocalizedException::class, false)) {
        class LocalizedException extends \Exception
        {
            public function __construct(\Magento\Framework\Phrase $phrase, ?\Throwable $cause = null, int $code = 0)
            {
                parent::__construct((string) $phrase, $code, $cause);
            }
        }
    }
}

namespace Magento\Checkout\Model {
    if (!class_exists(Session::class, false)) {
        class Session
        {
            private int $twoSelectedTerm = 0;

            private ?\Magento\Quote\Model\Quote $quote = null;

            public function getTwoSelectedTerm(): int
            {
                return $this->twoSelectedTerm;
            }

            public function setTwoSelectedTerm(int $days): void
            {
                $this->twoSelectedTerm = $days;
            }

            public function getQuote(): \Magento\Quote\Model\Quote
            {
                if ($this->quote === null) {
                    $this->quote = new \Magento\Quote\Model\Quote();
                }
                return $this->quote;
            }

            public function setQuote(\Magento\Quote\Model\Quote $quote): void
            {
                $this->quote = $quote;
            }
        }
    }
}

namespace Two\Gateway\Api\Config {
    if (!interface_exists(RepositoryInterface::class, false)) {
        interface RepositoryInterface
        {
            /** @return int[] */
            public function getAllBuyerTerms(?int $storeId = null): array;

            public function isBuyerTermAvailable(int $termDays, ?int $storeId = null): bool;

            public function isCompanySearchEnabled(?int $storeId = null): bool;
        }
    }
}

namespace Hyva\Checkout\Model\Magewire\Payment {
    use Hyva\Checkout\Model\Magewire\OrderData\AbstractOrderData;
    use Magento\Quote\Api\CartManagementInterface;
    use Magento\Quote\Model\Quote;

    if (!class_exists(AbstractPlaceOrderService::class, false)) {
        abstract class AbstractPlaceOrderService
        {
            public function __construct(CartManagementInterface $cartManagement, ?AbstractOrderData $orderData = null)
            {
            }

            public function placeOrder(Quote $quote): int
            {
                return 1;
            }

            abstract public function canPlaceOrder(): bool;
        }
    }
}
