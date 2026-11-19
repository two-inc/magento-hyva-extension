<?php

declare(strict_types=1);

// Minimal stubs of the Hyvä form classes CompanySortOrderModifier works on.
// See Test/bootstrap.php for the stubbing convention.

namespace Magento\Quote\Api\Data {
    if (!interface_exists(AddressInterface::class, false)) {
        interface AddressInterface
        {
            public const KEY_COUNTRY_ID = 'country_id';
            public const KEY_STREET = 'street';
            public const KEY_COMPANY = 'company';
            public const KEY_TELEPHONE = 'telephone';
            public const KEY_POSTCODE = 'postcode';
            public const KEY_CITY = 'city';
            public const KEY_REGION = 'region';
        }
    }
}

namespace Hyva\Checkout\Model\Form {
    if (!class_exists(AbstractEntityFormModifier::class, false)) {
        abstract class AbstractEntityFormModifier
        {
            abstract public function apply(AbstractEntityForm $form): AbstractEntityForm;
        }
    }

    if (!class_exists(EntityFormElementCollection::class, false)) {
        class EntityFormElementCollection
        {
            /** @var array<string, EntityField\AbstractEntityField> */
            private $items = [];

            /** @param array<string, EntityField\AbstractEntityField> $items */
            public function fill(array $items): self
            {
                $this->items = $items;
                return $this;
            }

            /** @return array<string, EntityField\AbstractEntityField> */
            public function all(): array
            {
                return $this->items;
            }

            public function sort(): self
            {
                uasort($this->items, static function ($a, $b): int {
                    return $a->getSortOrder() - $b->getSortOrder();
                });
                return $this;
            }
        }
    }

    if (!class_exists(AbstractEntityFormContext::class, false)) {
        class AbstractEntityFormContext
        {
            /** @var EntityFormElementCollection */
            public $elements;

            public function __construct()
            {
                $this->elements = new EntityFormElementCollection();
            }

            public function elements(): EntityFormElementCollection
            {
                return $this->elements;
            }
        }
    }

    if (!class_exists(AbstractEntityForm::class, false)) {
        class AbstractEntityForm
        {
            /** @var array<string, array<string, callable>> */
            public $listeners = [];

            /** @var AbstractEntityFormContext */
            private $context;

            /**
             * The context's elements, in the order Hyvä's populate() leaves
             * them, keyed by id.
             *
             * @param array<string, int> $positions
             */
            public function __construct(array $positions)
            {
                $this->context = new AbstractEntityFormContext();
                $fields = [];
                foreach ($positions as $id => $position) {
                    $fields[$id] = new EntityField\AbstractEntityField($position);
                }
                $this->context->elements()->fill($fields);
            }

            public function registerModificationListener(string $name, string $event, callable $modifier): self
            {
                $this->listeners[$event][$name] = $modifier;
                return $this;
            }

            public function dispatchModificationHook(string $event): void
            {
                foreach ($this->listeners[$event] ?? [] as $listener) {
                    $listener($this);
                }
            }

            public function context(): AbstractEntityFormContext
            {
                return $this->context;
            }
        }
    }
}

namespace Hyva\Checkout\Model\Form\EntityField {
    if (!class_exists(AbstractEntityField::class, false)) {
        class AbstractEntityField
        {
            /** @var int */
            private $position;

            public function __construct(int $position)
            {
                $this->position = $position;
            }

            public function getSortOrder(): int
            {
                return $this->position;
            }
        }
    }
}
