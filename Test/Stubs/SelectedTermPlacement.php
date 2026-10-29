<?php

declare(strict_types=1);

// Minimal stubs of the Magento/Hyva quote, session and placement types the
// selected-term suite exercises. Only the surface the code under test
// actually calls is stubbed — see Test/bootstrap.php for the convention.

namespace Magento\Quote\Model\Quote {
    if (!class_exists(Payment::class, false)) {
        class Payment
        {
            /** @var array<string, mixed> */
            private array $additionalInformation = [];

            /**
             * Magento's own signature: one key with the two-argument form,
             * the whole array with the one-argument form.
             *
             * @param array<string, mixed>|string $information
             */
            public function setAdditionalInformation($information, $value = null): self
            {
                if (is_array($information)) {
                    $this->additionalInformation = $information;
                    return $this;
                }
                $this->additionalInformation[$information] = $value;
                return $this;
            }

            /** @return array<string, mixed> */
            public function getAdditionalInformation(): array
            {
                return $this->additionalInformation;
            }
        }
    }
}

namespace Magento\Quote\Model {
    use Magento\Quote\Model\Quote\Payment;

    if (!class_exists(Quote::class, false)) {
        class Quote
        {
            private ?Payment $payment = null;

            public function getPayment(): Payment
            {
                if ($this->payment === null) {
                    $this->payment = new Payment();
                }
                return $this->payment;
            }

            public function setPayment(Payment $payment): self
            {
                $this->payment = $payment;
                return $this;
            }
        }
    }
}

namespace Magento\Quote\Api {
    use Magento\Quote\Model\Quote;

    if (!interface_exists(CartRepositoryInterface::class, false)) {
        interface CartRepositoryInterface
        {
            public function save(Quote $quote): void;
        }
    }
}

namespace Magento\Checkout\Model {
    if (!class_exists(Session::class, false)) {
        class Session
        {
            private int $twoSelectedTerm = 0;

            public function getTwoSelectedTerm(): int
            {
                return $this->twoSelectedTerm;
            }

            public function setTwoSelectedTerm(int $days): void
            {
                $this->twoSelectedTerm = $days;
            }
        }
    }
}

namespace Hyva\Checkout\Model\Magewire\Payment {
    use Magento\Quote\Model\Quote;

    if (!class_exists(AbstractPlaceOrderService::class, false)) {
        abstract class AbstractPlaceOrderService
        {
            public function placeOrder(Quote $quote, ?int $orderId = null): int
            {
                return 1;
            }

            abstract public function canPlaceOrder(): bool;
        }
    }
}
