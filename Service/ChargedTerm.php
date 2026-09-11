<?php

/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 */
declare(strict_types=1);

namespace Two\GatewayHyva\Service;

use Magento\Checkout\Model\Session as CheckoutSession;
use Two\Gateway\Api\Config\RepositoryInterface as ConfigRepository;

/**
 * The payment term this checkout would be charged for.
 *
 * Single-sourced across the chip state, the placement payload and the page
 * config, so no two of them can name a different term (ABN-556). The answer
 * mirrors the one the base module prices the surcharge on: a term the
 * merchant no longer offers falls back to the configured default, because
 * honouring it would price a fee the order cannot carry.
 */
class ChargedTerm
{
    public function __construct(
        private CheckoutSession $checkoutSession,
        private ConfigRepository $configRepository,
    ) {
    }

    public function resolve(?int $storeId = null): int
    {
        $selected = (int) $this->checkoutSession->getTwoSelectedTerm();
        if ($selected > 0 && $this->configRepository->isBuyerTermAvailable($selected, $storeId)) {
            return $selected;
        }

        return (int) $this->configRepository->getDefaultPaymentTerm($storeId);
    }
}
