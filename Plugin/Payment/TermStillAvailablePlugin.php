<?php

/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 */
declare(strict_types=1);

namespace Two\GatewayHyva\Plugin\Payment;

use Magento\Checkout\Model\Session as CheckoutSession;
use Magento\Framework\Exception\LocalizedException;
use Magento\Quote\Model\Quote;
use Two\Gateway\Api\Config\RepositoryInterface as ConfigRepository;
use Two\GatewayHyva\Model\Magewire\Payment\PlaceOrderService;

/**
 * Re-checks the buyer's selected payment term against the live offered set
 * immediately before order placement — parity with WooCommerce/PrestaShop
 * (TWO-24812), which both re-validate here because the backend term list can
 * change between checkout render and submit.
 *
 * Targets placeOrder(), not canPlaceOrder(): AbstractPlaceOrderService's
 * default evaluateCompletion()/canRedirect() both report success even when
 * canPlaceOrder() blocked placement and no order was created, so a false
 * return there would silently redirect the buyer to a success page.
 * Throwing here instead is caught by the processor's existing exception
 * pipeline, which is wired to the buyer-visible error dialog.
 *
 * Mirrors WC_Twoinc::process_payment()'s fail-open stance: an empty offered
 * set (cold cache, explicit []) is not treated as "nothing is available" —
 * it falls back to pre-feature behaviour rather than hard-blocking checkout.
 */
class TermStillAvailablePlugin
{
    public function __construct(
        private CheckoutSession $checkoutSession,
        private ConfigRepository $configRepository,
    ) {
    }

    public function beforePlaceOrder(PlaceOrderService $subject, Quote $quote): void
    {
        $selectedTerm = (int) $this->checkoutSession->getTwoSelectedTerm();
        if ($selectedTerm <= 0) {
            return;
        }

        $offered = array_map('intval', $this->configRepository->getAllBuyerTerms((int) $quote->getStoreId()));

        if (count($offered) > 0 && !in_array($selectedTerm, $offered, true)) {
            throw new LocalizedException(
                __('The selected payment term is no longer available. Please review the payment options and place the order again.')
            );
        }
    }
}
