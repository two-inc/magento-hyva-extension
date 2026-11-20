<?php

/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 */
declare(strict_types=1);

namespace Two\GatewayHyva\Plugin\Payment;

use Magento\Checkout\Model\Session as CheckoutSession;
use Magento\Quote\Api\CartRepositoryInterface;
use Magento\Quote\Model\Quote;
use Two\GatewayHyva\Model\Magewire\Payment\PlaceOrderService;

/**
 * States the buyer's chip selection on the quote payment immediately before
 * placement (ABN-621).
 *
 * The chip records the choice in the checkout session only, and the base
 * module composes the order from the payment's additional information, so
 * without this the order was composed for the configured default term while
 * the fee line was priced for the chosen one.
 *
 * Here rather than in setPaymentData(): that runs only while order intent is
 * enabled, and it replaces the whole additional-information array, so a term
 * recorded before it would be lost. Running last, on the quote placement
 * reloads, it covers every path and a late chip change.
 */
class RecordSelectedTermPlugin
{
    public function __construct(
        private CartRepositoryInterface $quoteRepository,
        private CheckoutSession $checkoutSession,
    ) {
    }

    public function beforePlaceOrder(PlaceOrderService $subject, Quote $quote): void
    {
        $days = (int) $this->checkoutSession->getTwoSelectedTerm();
        if ($days <= 0) {
            // No chip choice: the default term is both priced and composed.
            return;
        }

        $payment = $quote->getPayment();
        $payment->setAdditionalInformation('selectedTerm', $days);
        $quote->setPayment($payment);
        $this->quoteRepository->save($quote);
    }
}
