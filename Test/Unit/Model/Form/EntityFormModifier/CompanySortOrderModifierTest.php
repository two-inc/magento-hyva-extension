<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\Model\Form\EntityFormModifier;

use Hyva\Checkout\Model\Form\AbstractEntityForm;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Two\GatewayHyva\Model\Form\EntityFormModifier\CompanySortOrderModifier;
use Two\GatewayHyva\ViewModel\CheckoutConfig;

/**
 * ABN-627: with company search in the address form, country and company come
 * before the street, then postcode + city and region + phone. The order is set
 * on the form context, which Hyvä Checkout 1.3 renders from, and no field's
 * position changes: the street's position is its first line's index.
 */
class CompanySortOrderModifierTest extends TestCase
{
    /**
     * A stock Hyvä shipping address form: positions, in the order populate()
     * leaves the context.
     */
    private const STORE_POSITIONS = [
        'firstname' => 3, 'lastname' => 5, 'street' => 7, 'country_id' => 11, 'region' => 12,
        'postcode' => 13, 'city' => 14, 'telephone' => 15, 'company' => 16, 'vat_id' => 20,
    ];

    /**
     * @return array<string, array{bool, array<string, int>, list<string>}>
     */
    public static function cases(): array
    {
        return [
            'search in the address form' => [false, self::STORE_POSITIONS, [
                'firstname', 'lastname', 'country_id', 'company', 'street', 'postcode', 'city', 'region', 'telephone', 'vat_id',
            ]],
            'a form without a region field' => [false, array_diff_key(self::STORE_POSITIONS, ['region' => 0]), [
                'firstname', 'lastname', 'country_id', 'company', 'street', 'postcode', 'city', 'telephone', 'vat_id',
            ]],
            'a form without a street field' => [false, array_diff_key(self::STORE_POSITIONS, ['street' => 0]), [
                'firstname', 'lastname', 'country_id', 'region', 'postcode', 'city', 'telephone', 'company', 'vat_id',
            ]],
            'search in the payment tile' => [true, self::STORE_POSITIONS, array_keys(self::STORE_POSITIONS)],
        ];
    }

    /**
     * @param array<string, int> $positions
     * @param list<string> $expected
     */
    #[DataProvider('cases')]
    public function testOrdersTheAddressFields(bool $searchInPaymentTile, array $positions, array $expected): void
    {
        $config = $this->createMock(CheckoutConfig::class);
        $config->method('getIsCompanySearchInPaymentTile')->willReturn($searchInPaymentTile);
        $form = new AbstractEntityForm($positions);

        (new CompanySortOrderModifier($config))->apply($form);
        $form->dispatchModificationHook('form:build');

        $elements = $form->context()->elements()->all();
        $this->assertSame($expected, array_keys($elements));
        foreach ($elements as $id => $element) {
            $this->assertSame($positions[$id], $element->getSortOrder(), "$id keeps its position");
        }
    }
}
