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
 * Single-sourced across the chip state, the placement payload and the
 * page config, so no two of them can name a different term (ABN-556). The
 * base module resolves the same question its own way for the surcharge, and
 * a term the merchant has since withdrawn falls back to the default there
 * too — honouring it here would price a fee the order cannot carry.
 *
 * An empty offered set is fail-open, matching the placement re-check: an
 * empty list is a cold cache rather than a statement that nothing is
 * available.
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
        if ($selected > 0 && $this->isOffered($selected, $storeId)) {
            return $selected;
        }

        return (int) $this->configRepository->getDefaultPaymentTerm($storeId);
    }

    private function isOffered(int $days, ?int $storeId): bool
    {
        $offered = array_map('intval', $this->configRepository->getAllBuyerTerms($storeId));

        return count($offered) === 0 || in_array($days, $offered, true);
    }
}
