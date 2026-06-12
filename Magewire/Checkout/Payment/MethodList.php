<?php
/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 */
declare(strict_types=1);

namespace Two\GatewayHyva\Magewire\Checkout\Payment;

use Hyva\Checkout\Magewire\Checkout\Payment\MethodList as HyvaMethodList;

/**
 * Hyva's payment method list refreshes on address and coupon changes
 * but not on carrier selection, while the shipping cost is part of the
 * basket value Two's minimum-order gate compares
 * (Two\Gateway\Service\Order\MinimumOrderGate via Two::isAvailable()).
 * Without this listener a carrier change that moves the basket across
 * the minimum leaves a stale method list on screen until some other
 * refresh event fires.
 */
class MethodList extends HyvaMethodList
{
    public function getListeners(): array
    {
        return array_merge(parent::getListeners(), [
            'shipping_method_selected' => 'refresh',
        ]);
    }
}
