<?php
/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 */

declare(strict_types=1);

namespace Two\GatewayHyva\Model\Form\EntityFormModifier;

use Hyva\Checkout\Model\Form\AbstractEntityForm;
use Hyva\Checkout\Model\Form\AbstractEntityFormModifier;
use Hyva\Checkout\Model\Form\EntityField\AbstractEntityField;
use Hyva\Checkout\Model\Form\EntityFormElementInterface;
use Magento\Quote\Api\Data\AddressInterface;

/**
 * Modifier to position Country and Company fields before Street Address
 *
 * Dynamically determines positions based on street field's current position,
 * placing country and company right before it.
 */
class CompanySortOrderModifier extends AbstractEntityFormModifier
{
    public function apply(AbstractEntityForm $form): AbstractEntityForm
    {
        // Get street field's current position to place country and company before it
        $streetPosition = $this->getStreetPosition($form);

        $countryPosition = $streetPosition - 2;
        $companyPosition = $streetPosition - 1;

        // Move country before street
        $form->modifyField(AddressInterface::KEY_COUNTRY_ID, function (
            AbstractEntityField $field,
        ) use ($countryPosition) {
            $field->setData(
                EntityFormElementInterface::POSITION,
                $countryPosition,
            );
        });

        // Move company right after country, before street
        return $form->modifyField(AddressInterface::KEY_COMPANY, function (
            AbstractEntityField $field,
        ) use ($companyPosition) {
            $field->setData(
                EntityFormElementInterface::POSITION,
                $companyPosition,
            );
        });
    }

    private function getStreetPosition(AbstractEntityForm $form): int
    {
        $streetField = $form->getField("street");
        if ($streetField) {
            return $streetField->getSortOrder();
        }

        // Fallback to default street position if not found
        return 7;
    }
}
