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
use Two\Gateway\Service\Order\ChargedTermResolver;

/**
 * Records the charged payment term on the quote payment immediately before
 * placement, because the base module reads it from there and refuses an order
 * whose term disagrees with the one the surcharge was priced on (ABN-556).
 */
class RecordSelectedTermPlugin
{
    public function __construct(
        private CartRepositoryInterface $quoteRepository,
        private ChargedTermResolver $chargedTerm,
    ) {
    }

    public function beforePlaceOrder(PlaceOrderService $subject, Quote $quote): void
    {
        $days = $this->chargedTerm->resolve((int) $quote->getStoreId());
        if ($days <= 0) {
            return;
        }

        $payment = $quote->getPayment();
        $payment->setAdditionalInformation('selectedTerm', $days);
        $quote->setPayment($payment);
        $this->quoteRepository->save($quote);
    }
}
