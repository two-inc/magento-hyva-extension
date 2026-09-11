<?php

declare(strict_types=1);

// Minimal stubs of the remaining collaborators the payment tile's Magewire
// component is constructed with — see Test/bootstrap.php for the convention.

namespace Magento\Framework\Locale {
    if (!interface_exists(ResolverInterface::class, false)) {
        interface ResolverInterface
        {
            public function getLocale();
        }
    }
}

namespace Magento\Quote\Api {
    if (!interface_exists(CartTotalRepositoryInterface::class, false)) {
        interface CartTotalRepositoryInterface
        {
            public function get($cartId);
        }
    }
}

namespace Two\Gateway\Api\Log {
    if (!interface_exists(RepositoryInterface::class, false)) {
        interface RepositoryInterface
        {
            public function addDebugLog($title, $data);

            public function addErrorLog($title, $data);
        }
    }
}

namespace Two\Gateway\Model\Config\Source {
    if (!class_exists(SurchargeType::class, false)) {
        class SurchargeType
        {
            public const NONE = 'none';
            public const PERCENTAGE = 'percentage';
            public const FIXED = 'fixed';
            public const FIXED_AND_PERCENTAGE = 'fixed_and_percentage';
        }
    }
}

namespace Two\Gateway\Service\Order {
    if (!class_exists(TermSurchargePreview::class, false)) {
        class TermSurchargePreview
        {
            public function taxDisplay(\Magento\Quote\Model\Quote $quote): string
            {
                return SurchargeDisplay::EXCL;
            }

            /** @return array<int, array{days: int, net: float, gross: float}> */
            public function build(
                \Magento\Quote\Model\Quote $quote,
                float $basis,
                array $terms,
                string $country,
                string $currency,
                int $storeId,
                string $context
            ): array {
                return [];
            }
        }
    }
}
