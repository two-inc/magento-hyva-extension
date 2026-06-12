<?php

declare(strict_types=1);

// Faithful stubs of the Hyva/Magewire classes Two\GatewayHyva\Magewire\
// Checkout\Payment\MethodList extends. The listener sets mirror the real
// classes (hyva-checkout 1.x) so the merge semantics under test are the
// ones production sees.

namespace Magewirephp\Magewire {
    if (!class_exists(Component::class, false)) {
        class Component
        {
            /** @var array<string, string> */
            protected $listeners = [];

            public function getListeners(): array
            {
                return $this->listeners;
            }
        }
    }
}

namespace Hyva\Checkout\Magewire\Checkout\Payment {
    use Magewirephp\Magewire\Component;

    if (!class_exists(MethodList::class, false)) {
        class MethodList extends Component
        {
            protected $listeners = [
                'billing_address_saved' => 'refresh',
                'shipping_address_saved' => 'refresh',
                'coupon_code_applied' => 'refresh',
                'coupon_code_revoked' => 'refresh',
            ];
        }
    }
}
