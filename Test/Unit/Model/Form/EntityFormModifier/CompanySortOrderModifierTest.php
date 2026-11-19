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
 * before the street, then postcode + city and region + phone. The fields reuse
 * the positions the store gave them, and the form context is sorted on build
 * because Hyvä Checkout 1.3 renders in the context's order.
 */
class CompanySortOrderModifierTest extends TestCase
{
    /**
     * Positions from a stock Hyvä shipping address form.
     */
    private const STORE_POSITIONS = [
        'firstname' => 3, 'lastname' => 5, 'street' => 7, 'country_id' => 11, 'region' => 12,
        'postcode' => 13, 'city' => 14, 'telephone' => 15, 'company' => 16,
    ];

    /**
     * @return array<string, array{bool, array<string, int>, array<string, int>}>
     */
    public static function cases(): array
    {
        return [
            'search in the address form' => [false, self::STORE_POSITIONS, [
                'firstname' => 3, 'lastname' => 5, 'country_id' => 7, 'company' => 11, 'street' => 12,
                'postcode' => 13, 'city' => 14, 'region' => 15, 'telephone' => 16,
            ]],
            'a form without a region field' => [false, array_diff_key(self::STORE_POSITIONS, ['region' => 0]), [
                'firstname' => 3, 'lastname' => 5, 'country_id' => 7, 'company' => 11, 'street' => 13,
                'postcode' => 14, 'city' => 15, 'telephone' => 16,
            ]],
            'search in the payment tile' => [true, self::STORE_POSITIONS, self::STORE_POSITIONS],
        ];
    }

    /**
     * @param array<string, int> $positions
     * @param array<string, int> $expected
     */
    #[DataProvider('cases')]
    public function testOrdersTheAddressFields(bool $searchInPaymentTile, array $positions, array $expected): void
    {
        $config = $this->createMock(CheckoutConfig::class);
        $config->method('getIsCompanySearchInPaymentTile')->willReturn($searchInPaymentTile);
        $form = new AbstractEntityForm($positions);

        (new CompanySortOrderModifier($config))->apply($form);
        $form->dispatchModificationHook('form:build');

        $actual = array_map(static function ($field): int {
            return $field->getSortOrder();
        }, $form->fields);
        asort($actual);
        asort($expected);
        $this->assertSame($expected, $actual);
        $this->assertSame($searchInPaymentTile ? 0 : 1, $form->context()->elements()->sorts);
    }
}
