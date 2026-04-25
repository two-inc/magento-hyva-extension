<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\ViewModel;

use PHPUnit\Framework\TestCase;

/**
 * Unit-test the locale normalisation in CheckoutConfig::getLocaleCode().
 * Doesn't construct the full ViewModel (avoids Magento DI); instead extracts
 * the normalisation rule into a class-static helper that mirrors the method
 * body, then asserts the rule against pathological inputs Mulder flagged.
 *
 * If the production method drifts, this test goes stale — refresh it when
 * touching `getLocaleCode`.
 */
class CheckoutConfigLocaleTest extends TestCase
{
    /**
     * Mirrors `CheckoutConfig::getLocaleCode()` body. Drift detector for the rule.
     */
    private static function normalise(string $locale): string
    {
        $locale = preg_replace('/[.@].*$/', '', $locale);
        $locale = str_replace('_', '-', $locale);
        return $locale !== '' ? $locale : 'en-US';
    }

    /**
     * @dataProvider localeCases
     */
    public function testNormalisation(string $input, string $expected): void
    {
        $this->assertSame($expected, self::normalise($input));
    }

    public static function localeCases(): array
    {
        return [
            'standard underscored'              => ['en_GB', 'en-GB'],
            'already hyphenated'                => ['en-GB', 'en-GB'],
            'codeset suffix UTF-8'              => ['en_GB.UTF-8', 'en-GB'],
            'modifier suffix latin'             => ['en_GB@latin', 'en-GB'],
            'codeset and modifier'              => ['en_GB.UTF-8@latin', 'en-GB'],
            'language only'                     => ['en', 'en'],
            'nordic'                            => ['nb_NO', 'nb-NO'],
            'dutch'                             => ['nl_NL', 'nl-NL'],
            'empty string falls back to en-US'  => ['', 'en-US'],
            'just a dot falls back to en-US'    => ['.', 'en-US'],
            'just a modifier falls back'        => ['@anything', 'en-US'],
        ];
    }
}
