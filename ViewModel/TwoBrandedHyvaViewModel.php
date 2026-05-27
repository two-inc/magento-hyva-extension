<?php

declare(strict_types=1);

namespace Two\GatewayHyva\ViewModel;

final class TwoBrandedHyvaViewModel implements BrandedHyvaViewModelInterface
{
    public function getAlpineFnPrefix(): string
    {
        return 'two';
    }

    public function getFormId(): string
    {
        return 'two_gateway_form';
    }

    public function getMethodCode(): string
    {
        return 'two_payment';
    }

    public function getMagewireBlockName(): string
    {
        return 'checkout.payment.method.two-payment-method';
    }
}
