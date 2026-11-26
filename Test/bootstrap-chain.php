<?php

declare(strict_types=1);

// Bootstrap for the Chain suite (phpunit.chain.xml): the same stubs as the unit
// suite, except that the base module's charged-term resolver is the REAL class,
// loaded from a checkout of the base module, not the answer-what-I-say stub in
// Test/Stubs. The suite exists to prove the term the buyer chose survives the
// chain up to the payment placement reads, and a stubbed resolver would let a
// break in that hand-off pass.
//
// Point TWO_BASE_MODULE at a checkout of the base module (CI checks it out into
// ./base-module). Absent, the suite refuses to run rather than skipping: a guard
// that quietly does not execute reads the same as one that passed.

$base = getenv('TWO_BASE_MODULE') ?: __DIR__ . '/../base-module';
$resolver = rtrim($base, '/') . '/Service/Order/ChargedTermResolver.php';

if (!is_file($resolver)) {
    throw new RuntimeException(
        "Chain suite needs the base module's ChargedTermResolver at $resolver. "
        . 'Check the base module out into ./base-module or set TWO_BASE_MODULE to its path.'
    );
}

// Loaded before the stubs: it only names its collaborators in type declarations,
// so it needs none of them at load time, and the stub file then skips its own
// resolver because this one is already defined.
require $resolver;
require __DIR__ . '/bootstrap.php';
