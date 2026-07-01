<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\Magewire\Checkout\Payment;

use PHPUnit\Framework\TestCase;
use Two\GatewayHyva\Magewire\Checkout\Payment\MethodList;

class MethodListTest extends TestCase
{
    /**
     * The subclass must ADD the carrier-selection refresh, not replace
     * Hyva's listener set — losing the address/coupon refreshes would
     * silently freeze the method list on those events instead.
     */
    public function testListenersExtendHyvaSetWithShippingMethodSelected(): void
    {
        $listeners = (new MethodList())->getListeners();

        $this->assertSame('refresh', $listeners['shipping_method_selected'] ?? null);
        foreach (
            [
                'billing_address_saved',
                'shipping_address_saved',
                'coupon_code_applied',
                'coupon_code_revoked',
            ] as $inherited
        ) {
            $this->assertSame('refresh', $listeners[$inherited] ?? null, "lost inherited listener: $inherited");
        }
    }
}
