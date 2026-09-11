<?php

/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 */
declare(strict_types=1);

namespace Two\GatewayHyva\Plugin\Payment;

use Magento\Quote\Api\CartRepositoryInterface;
use Magento\Quote\Model\Quote;
use Two\GatewayHyva\Model\Magewire\Payment\PlaceOrderService;
use Two\GatewayHyva\Service\ChargedTerm;

/**
 * Records the charged payment term on the quote payment immediately before
 * placement, because the base module reads it from there and refuses an order
 * whose term disagrees with the one the surcharge was priced on (ABN-556).
 *
 * Here rather than only where the tile assembles its payload: that assembly
 * runs only while order intent is enabled, and a round trip earlier, so a chip
 * clicked afterwards would leave the recorded term behind.
 */
class RecordSelectedTermPlugin
{
    public function __construct(
        private CartRepositoryInterface $quoteRepository,
        private ChargedTerm $chargedTerm,
    ) {
    }

    public function beforePlaceOrder(PlaceOrderService $subject, Quote $quote): void
    {
        $days = $this->chargedTerm->resolve((int) $quote->getStoreId());
        if ($days <= 0) {
            // Nothing is offered, so there is no term to state.
            return;
        }

        $payment = $quote->getPayment();
        $payment->setAdditionalInformation('selectedTerm', $days);
        $quote->setPayment($payment);
        $this->quoteRepository->save($quote);
    }
}
