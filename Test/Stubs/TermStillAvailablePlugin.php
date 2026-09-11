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

            public function setAdditionalInformation(string $key, $value): self
            {
                $this->additionalInformation[$key] = $value;

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

            public function getTwoSelectedTerm(): int
            {
                return $this->twoSelectedTerm;
            }

            public function setTwoSelectedTerm(int $days): void
            {
                $this->twoSelectedTerm = $days;
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

            public function isCompanySearchEnabled(?int $storeId = null): bool;
        }
    }
}

namespace Two\Gateway\Service\Order {
    if (!class_exists(ChargedTermResolver::class, false)) {
        /**
         * The base module's charged-term resolver. Its resolution is tested in
         * that module; here it answers whatever a test sets, and records the
         * store ids it was asked about.
         */
        class ChargedTermResolver
        {
            public int $resolved = 0;

            /** @var array<int, ?int> */
            public array $storeIds = [];

            public function __construct(
                ?\Magento\Checkout\Model\Session $checkoutSession = null,
                ?\Two\Gateway\Api\Config\RepositoryInterface $configRepository = null
            ) {
            }

            public function resolve(?int $storeId = null): int
            {
                $this->storeIds[] = $storeId;

                return $this->resolved;
            }
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
