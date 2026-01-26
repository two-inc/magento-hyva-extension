# Magento Hyvä Extension — AI Agent Context

## Project Overview

Hyvä theme extension for Two's Magento plugin, providing modern frontend components using Alpine.js and Tailwind CSS.

- **Language**: PHP 7.4+ and JavaScript (Alpine.js)
- **Framework**: Magento 2 module for Hyvä theme
- **Purpose**: Frontend components for Two BNPL checkout in Hyvä theme

## Directory Structure

```
etc/                  # Module configuration
view/frontend/        # Hyvä frontend templates and layouts
├── templates/        # .phtml template files
├── layout/           # XML layout files
└── web/              # CSS/JS assets
ViewModel/            # View models for templates
```

## Development Notes

- Built specifically for Hyvä theme (not compatible with Luma)
- Uses Alpine.js for JavaScript reactivity (not Knockout.js)
- Tailwind CSS for styling (utility-first approach)
- View models replace traditional Magento blocks
- Extends base Two Magento plugin functionality

## Testing

```bash
php bin/magento setup:upgrade       # Apply changes
php bin/magento cache:flush         # Clear cache
# Test in browser with Hyvä theme active
```

## Common Patterns

- Use Alpine.js x-data, x-show, x-if directives
- Tailwind utility classes for styling
- View models for data preparation
- Component-based template structure
- Progressive enhancement approach
