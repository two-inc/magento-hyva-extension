<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\Etc;

use PHPUnit\Framework\TestCase;

/**
 * Sanity check on etc/module.xml. Catches namespace drift like ABN-362 where the
 * ABN-layer commit renamed every PHP class but missed the module declaration.
 */
class ModuleConfigTest extends TestCase
{
    private const MODULE_XML = __DIR__ . '/../../../etc/module.xml';

    public function testModuleXmlParses(): void
    {
        $xml = simplexml_load_file(self::MODULE_XML);
        $this->assertNotFalse($xml, 'etc/module.xml must be valid XML');
    }

    public function testModuleNameAndSequenceMatchNamespace(): void
    {
        $xml = simplexml_load_file(self::MODULE_XML);
        $module = $xml->module;

        $expectedModule = $this->expectedModuleName();
        $expectedParent = $this->expectedParentModule();

        $this->assertSame(
            $expectedModule,
            (string)$module['name'],
            'module/@name must match the autoload PSR-4 brand'
        );

        $sequenced = [];
        foreach ($module->sequence->module as $dep) {
            $sequenced[] = (string)$dep['name'];
        }
        $this->assertContains(
            $expectedParent,
            $sequenced,
            sprintf('module sequence must depend on %s', $expectedParent)
        );
    }

    /**
     * Read the PSR-4 namespace from composer.json to derive the expected module
     * name. Two\GatewayHyva → Two_GatewayHyva, ABN\GatewayHyva → ABN_GatewayHyva.
     */
    private function expectedModuleName(): string
    {
        $composer = json_decode(file_get_contents(__DIR__ . '/../../../composer.json'), true);
        $namespaces = array_keys($composer['autoload']['psr-4']);
        $primary = rtrim($namespaces[0], '\\');
        return str_replace('\\', '_', $primary);
    }

    private function expectedParentModule(): string
    {
        $composer = json_decode(file_get_contents(__DIR__ . '/../../../composer.json'), true);
        $namespaces = array_keys($composer['autoload']['psr-4']);
        $primary = rtrim($namespaces[0], '\\');
        // Two\GatewayHyva → Two_Gateway, ABN\GatewayHyva → ABN_Gateway
        $parts = explode('\\', $primary);
        return $parts[0] . '_Gateway';
    }
}
