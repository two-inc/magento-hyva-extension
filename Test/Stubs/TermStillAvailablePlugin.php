<?php

declare(strict_types=1);

// Minimal stubs of the Magento/Hyva types TermStillAvailablePlugin and
// PlaceOrderService depend on. Only the surface these classes actually
// call is stubbed — see Test/bootstrap.php for the convention.

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

namespace Magento\Quote\Model {
    if (!class_exists(Quote::class, false)) {
        class Quote
        {
            private int $storeId = 0;

            public function getStoreId(): int
            {
                return $this->storeId;
            }

            public function setStoreId(int $storeId): self
            {
                $this->storeId = $storeId;
                return $this;
            }
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
