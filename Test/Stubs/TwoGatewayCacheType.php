<?php

declare(strict_types=1);

// Minimal stub of the base module's gateway cache type, referenced for its
// cache tag only. See Test/bootstrap.php for the stubbing convention.

namespace Two\Gateway\Model\Cache\Type {
    if (!class_exists(TwoGateway::class, false)) {
        class TwoGateway
        {
            public const CACHE_TAG = 'TWO_GATEWAY';
        }
    }
}
