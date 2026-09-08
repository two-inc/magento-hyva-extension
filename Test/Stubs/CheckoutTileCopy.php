<?php

declare(strict_types=1);

// Minimal stub of the base module's tile-copy service, the surface
// CheckoutConfig delegates the subtitle and about link to. See
// Test/bootstrap.php for the stubbing convention, and
// dev/base-tile-copy-parity.sh for the guard that reds CI if the base
// renames one of these methods out from under the stub.

namespace Two\Gateway\Model\Ui {
    if (!class_exists(CheckoutTileCopy::class, false)) {
        class CheckoutTileCopy
        {
            public function getSubtitleHtml(): string
            {
                return '';
            }

            public function isAboutLinkVisible(): bool
            {
                return false;
            }

            public function getAboutLinkUrl(): string
            {
                return '';
            }

            public function getAboutLinkText(): string
            {
                return '';
            }
        }
    }
}
