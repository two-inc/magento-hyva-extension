<?php

declare(strict_types=1);

// Minimal stub of the base module's API-key verdict service, which
// CheckoutConfig and the admin Company search row read. See Test/bootstrap.php
// for the stubbing convention, and dev/base-api-key-status-parity.sh for the
// guard that reds CI if the base renames one of these members out from under
// the stub. isDefinitiveFailure() carries the base's documented predicate so a
// test fake that overrides getStatus() alone exercises the real gate.

namespace Two\Gateway\Service\Merchant {
    if (!class_exists(ApiKeyStatus::class, false)) {
        class ApiKeyStatus
        {
            public const OK = 'ok';
            public const INVALID_KEY = 'invalid_key';
            public const SERVICE_ERROR = 'service_error';
            public const UNREACHABLE = 'unreachable';
            public const ERROR = 'error';
            public const MALFORMED_RESPONSE = 'malformed_response';
            public const NOT_CONFIGURED = 'not_configured';

            /**
             * @return array{status: string, code: ?int, merchant: ?array}
             */
            public function getStatus(?int $storeId = null, ?string $scope = null): array
            {
                return ['status' => self::NOT_CONFIGURED, 'code' => null, 'merchant' => null];
            }

            public function isDefinitiveFailure(?int $storeId = null, ?string $scope = null): bool
            {
                $status = $this->getStatus($storeId, $scope)['status'];

                return $status === self::INVALID_KEY || $status === self::NOT_CONFIGURED;
            }
        }
    }
}
