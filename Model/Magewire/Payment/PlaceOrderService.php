<?php

/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 */

namespace ABN\GatewayHyva\Model\Magewire\Payment;

use Hyva\Checkout\Model\Magewire\Payment\AbstractPlaceOrderService;
use Magento\Quote\Model\Quote;

class PlaceOrderService extends AbstractPlaceOrderService
{
    public function canPlaceOrder(): bool
    {
        return true;
    }

    /**
     * Redirect to the ABNGateway controller
     *
     * @see https://docs.hyva.io/checkout/hyva-checkout/devdocs/payment-integration-api.html
     *
     * @param Quote $quote
     * @param int|null $orderId
     * @return string
     * @SuppressWarnings (PHPMD.UnusedFormalParameter)
     */
    public function getRedirectUrl(Quote $quote, ?int $orderId = null): string
    {
        return "/hyva_abn/payment/orderredirect";
    }
}
