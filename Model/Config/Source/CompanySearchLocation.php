<?php

/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 */

declare(strict_types=1);

namespace Two\GatewayHyva\Model\Config\Source;

use Magento\Framework\Data\OptionSourceInterface;
use Two\GatewayHyva\ViewModel\CheckoutConfig;

/**
 * TWO-25326 §7.1 (2026-08-03 ruling): one company-search control per
 * platform, and this decides WHERE it renders — address area, or payment
 * tile — never whether it exists.
 */
class CompanySearchLocation implements OptionSourceInterface
{
    public function toOptionArray(): array
    {
        return [
            [
                'value' => CheckoutConfig::COMPANY_SEARCH_LOCATION_ADDRESS_AREA,
                'label' => __('Address area (default)'),
            ],
            [
                'value' => CheckoutConfig::COMPANY_SEARCH_LOCATION_PAYMENT_TILE,
                'label' => __('Two payment tile'),
            ],
        ];
    }
}
