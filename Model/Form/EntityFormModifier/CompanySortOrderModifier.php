<?php
/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 */

declare(strict_types=1);

namespace Two\GatewayHyva\Model\Form\EntityFormModifier;

use Hyva\Checkout\Model\Form\AbstractEntityForm;
use Hyva\Checkout\Model\Form\AbstractEntityFormModifier;
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
     * The address fields in display order, placed where the street field sits
     * in the store's order. Every other field keeps the store's order.
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
        // Hyvä Checkout 1.3 renders a form in its context's element order. The
        // order is set there rather than through field positions: the street
        // field's position is the index of its first line, so changing it
        // renames the input.
        if ($this->checkoutConfig->getIsCompanySearchInPaymentTile() || !method_exists($form, 'context')) {
            return $form;
        }

        return $form->registerModificationListener('two_company_sort_order', 'form:build', static function (AbstractEntityForm $form): void {
            $elements = $form->context()->elements();
            $elements->fill(self::arrange($elements->sort()->all()));
        });
    }

    /**
     * @param array<string, mixed> $elements keyed by field id, in the store's order
     * @return array<string, mixed>
     */
    private static function arrange(array $elements): array
    {
        if (!isset($elements[AddressInterface::KEY_STREET])) {
            return $elements;
        }

        $address = array_intersect_key(array_flip(self::ADDRESS_ORDER), $elements);
        $arranged = [];
        foreach ($elements as $id => $element) {
            if ($id === AddressInterface::KEY_STREET) {
                foreach (array_keys($address) as $addressId) {
                    $arranged[$addressId] = $elements[$addressId];
                }
            } elseif (!isset($address[$id])) {
                $arranged[$id] = $element;
            }
        }

        return $arranged;
    }
}
