<?php
/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 */
declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\I18n;

use PHPUnit\Framework\TestCase;

/**
 * An untranslated msgid renders the English source with no error, no warning
 * and no log line, so nothing but a check like this notices.
 */
class CompanyRequiredMessageTranslationTest extends TestCase
{
    private const MSGID = 'Please select your company before paying with %1.';

    /**
     * @return array<string, array{0: string}>
     */
    public static function shippedLocaleProvider(): array
    {
        $cases = [];

        foreach (['es_ES', 'nb_NO', 'nl_NL', 'sv_SE'] as $locale) {
            $cases[$locale] = [$locale];
        }

        return $cases;
    }

    /**
     * @dataProvider shippedLocaleProvider
     */
    public function testCompanyRequiredMessageIsTranslated(string $locale): void
    {
        $rows = $this->loadCatalogue($locale);

        $this->assertArrayHasKey(
            self::MSGID,
            $rows,
            sprintf('The company-required message renders in English for %s.', $locale)
        );
        $this->assertNotSame(
            '',
            trim($rows[self::MSGID]),
            sprintf('The company-required message has an empty %s translation.', $locale)
        );
        $this->assertStringContainsString(
            '%1',
            $rows[self::MSGID],
            sprintf('The %s translation drops the brand placeholder.', $locale)
        );
    }

    /**
     * @return array<string, string> msgid => translation
     */
    private function loadCatalogue(string $locale): array
    {
        $path = dirname(__DIR__, 3) . '/i18n/' . $locale . '.csv';
        $handle = fopen($path, 'r');
        $this->assertNotFalse($handle, sprintf('Cannot read i18n/%s.csv.', $locale));

        $rows = [];
        while (($row = fgetcsv($handle)) !== false) {
            if (isset($row[0], $row[1])) {
                $rows[$row[0]] = (string) $row[1];
            }
        }
        fclose($handle);

        // A parse that drops rows would make every assertion above vacuously
        // pass. This catalogue is small enough that a row-count floor would
        // say nothing, so compare against the file's own line count instead.
        $lines = array_filter(
            explode("\n", (string) file_get_contents($path)),
            static fn (string $line): bool => trim($line) !== ''
        );
        $this->assertCount(
            count($lines),
            $rows,
            sprintf(
                'Parsed %d of %d rows in i18n/%s.csv — the parse is broken.',
                count($rows),
                count($lines),
                $locale
            )
        );

        return $rows;
    }
}
