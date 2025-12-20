# Two Gateway Hyva Extension

- **Two Gateway Module Version**: 1.13.4

## Introduction

This document provides instructions for installing the Two Gateway Payment Method module with Hyvä Checkout compatibility for Magento 2. This module ensures a seamless payment experience for stores using the Hyvä frontend.

## Compatibility

| Component          | Version | Link                                                                                                                    |
| ------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| Magento            | 2.4.x   | [Release Notes](https://experienceleague.adobe.com/en/docs/commerce-operations/release/notes/magento-open-source/2-4-8) |
| Two Gateway Module | ^1.13.1 | [two-inc/magento-plugin](https://github.com/two-inc/magento-plugin)                                                     |
| Hyvä Checkout      | ^1.3    | [Hyvä Checkout](https://www.hyva.io/hyva-checkout.html)                                                                 |

## Prerequisites

- Hyvä Theme and Hyvä Checkout module installed.
- Access to the Hyvä private composer repository.
- Node.js and Tailwind dependencies installed for building CSS.

## Installation Steps

### 1. Install Hyvä Theme & Checkout (if not already installed)

Use composer to install the necessary Hyvä packages:

```bash
composer config repositories.private-packagist composer {repositories path}
composer config --auth http-basic.hyva-themes.repo.packagist.com token {token}
composer require hyva-themes/magento2-default-theme
composer require hyva-themes/magento2-hyva-checkout
```

### 2. Configure Hyvä Checkout

Configure basic settings via the Magento Admin:
`Admin > Stores > Settings > Configuration > Hyvä Themes > Checkout`

### 3. Install Two Gateway Hyva Module

1. Download and extract the module's ZIP package.
2. Connect to your Magento server.
3. Upload the module files to `app/code/Two/GatewayHyva`.

### 4. Run Magento Commands

Execute the following commands from your Magento root directory:

```bash
php bin/magento setup:upgrade
php bin/magento setup:di:compile
php bin/magento setup:static-content:deploy -f
php bin/magento cache:clean
php bin/magento cache:flush
```

### 5. Generate Hyvä Configuration

Run the Hyvä configuration generator:

```bash
php bin/magento hyva:config:generate
```

### 6. Build Tailwind CSS (Optional: If using custom styles)

**For custom Hyvä themes:**

```bash
npm --prefix app/design/frontend/<Vendor>/<Theme>/web/tailwind run ci
npm --prefix app/design/frontend/<Vendor>/<Theme>/web/tailwind run build-prod
```

**For the default Hyvä theme:**

```bash
npm --prefix vendor/hyva-themes/magento2-default-theme/web/tailwind run ci
npm --prefix vendor/hyva-themes/magento2-default-theme/web/tailwind run build-prod
```

### 7. Configure Two Gateway

Set up your Two Gateway credentials and settings in the Magento Admin:
`Admin > Stores > Configuration > Two Gateway`

## Testing

1. Check the module is enabled: `php bin/magento module:status | grep Two_GatewayHyva`
2. Navigate to your store's frontend checkout page
3. Verify that the Two Gateway payment method is visible
4. Place a test order to ensure everything is working correctly

## Troubleshooting

- Ensure Hyvä theme is properly installed
- Check Magento logs: `var/log/system.log` and `var/log/exception.log`
- Verify CSP (Content Security Policy) settings if scripts are blocked
- Clear all caches after installation

## Development

For developers looking to extend or customize the Two Gateway Hyva module, follow these steps:

1. Install `direnv` and `uv` and configure `.envrc` file with `layout python`.
2. Install the required tools and dependencies:

```bash
direnv allow
uv tool install bumpver
uv tool install pre-commit
pre-commit install
```
