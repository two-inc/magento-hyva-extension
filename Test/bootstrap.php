<?php

declare(strict_types=1);

// Minimal bootstrap for unit tests that don't need Magento DI.
// Tests requiring Magento framework classes should add stubs under Test/Stubs/
// and require them here.

require __DIR__ . '/Stubs/HyvaCheckoutPaymentMethodList.php';

spl_autoload_register(static function (string $class): void {
    $prefix = 'Two\\GatewayHyva\\';
    if (strncmp($class, $prefix, strlen($prefix)) === 0) {
        $file = __DIR__ . '/../' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
        if (is_file($file)) {
            require $file;
        }
    }
});
