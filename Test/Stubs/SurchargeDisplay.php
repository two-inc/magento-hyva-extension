<?php

declare(strict_types=1);

// Minimal stub of the base module's display-mode constants that
// GatewayMethod::resolveDisplayAmount() switches on. See Test/bootstrap.php
// for the stubbing convention — only the surface actually used is stubbed.

namespace Two\Gateway\Service\Order {
    if (!class_exists(SurchargeDisplay::class, false)) {
        class SurchargeDisplay
        {
            public const EXCL = 'excl';
            public const INCL = 'incl';
            public const BOTH = 'both';
        }
    }
}
