<?php
/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 */

declare(strict_types=1);

namespace Two\GatewayHyva\Model\Form\EntityFormModifier;

use Hyva\Checkout\Model\Form\AbstractEntityForm;
use Hyva\Checkout\Model\Form\AbstractEntityFormModifier;
use Hyva\Checkout\Model\Form\EntityFormElementInterface;
use Magento\Quote\Api\Data\AddressInterface;
use Two\GatewayHyva\ViewModel\CheckoutConfig;

/**
 * Orders the address fields for company search in the address form (ABN-627).
 *
 * The buyer picks a country, which decides where the registry search looks,
 * then searches for the company, and autofill fills the address below. So
 * country and company come before the street, and the four half-width fields
 * after it pair up as postcode + city and region + phone. With search in the
 * payment tile the form keeps the store's own order.
 */
class CompanySortOrderModifier extends AbstractEntityFormModifier
{
    /**
     * The address fields in display order. Each takes one of the positions the
     * store gave these fields, so anything else the store placed around the
     * address keeps its place relative to it.
     */
    private const ADDRESS_ORDER = [
        AddressInterface::KEY_COUNTRY_ID,
        AddressInterface::KEY_COMPANY,
        AddressInterface::KEY_STREET,
        AddressInterface::KEY_POSTCODE,
        AddressInterface::KEY_CITY,
        AddressInterface::KEY_REGION,
        AddressInterface::KEY_TELEPHONE,
    ];

    /**
     * @var CheckoutConfig
     */
    private $checkoutConfig;

    public function __construct(CheckoutConfig $checkoutConfig)
    {
        $this->checkoutConfig = $checkoutConfig;
    }

    public function apply(AbstractEntityForm $form): AbstractEntityForm
    {
        if ($this->checkoutConfig->getIsCompanySearchInPaymentTile()) {
            return $form;
        }

        $fields = array_values(array_filter(array_map([$form, 'getField'], self::ADDRESS_ORDER)));
        $positions = array_map(static function ($field): int {
            return $field->getSortOrder();
        }, $fields);
        sort($positions);
        foreach ($fields as $index => $field) {
            $field->setData(EntityFormElementInterface::POSITION, $positions[$index]);
        }

        // From Hyvä Checkout 1.3 the form renders in the order of its context's
        // elements, which the form's own sort() leaves untouched.
        if (method_exists($form, 'context')) {
            $form->registerModificationListener('two_company_sort_order', 'form:build', static function (AbstractEntityForm $form): void {
                $form->context()->elements()->sort();
            });
        }

        return $form;
    }
}
