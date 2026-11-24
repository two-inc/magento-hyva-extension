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

            /** @var array<int, array{event: string, params: array<int, mixed>}> */
            public array $emitted = [];

            /** @var array<int, string> */
            public array $errorMessages = [];

            public function getListeners(): array
            {
                return $this->listeners;
            }

            /** @param mixed ...$params */
            public function emit(string $event, ...$params): void
            {
                $this->emitted[] = ['event' => $event, 'params' => $params];
            }

            /** @param \Magento\Framework\Phrase|string $message */
            public function dispatchErrorMessage($message): void
            {
                $this->errorMessages[] = (string) $message;
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
