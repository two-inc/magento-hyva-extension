<?php

declare(strict_types=1);

namespace ABN\GatewayHyva\ViewModel;

use Magento\Checkout\Model\Session as SessionCheckout;
use Magento\Framework\App\Config\ScopeConfigInterface;
use Magento\Framework\Exception\LocalizedException;
use Magento\Framework\View\Element\Block\ArgumentInterface;
use Magento\Quote\Api\ShippingMethodManagementInterface;
use Magento\Store\Model\ScopeInterface;
use Magento\Store\Model\StoreManagerInterface;

class GetQuoteDetails implements ArgumentInterface
{
    protected SessionCheckout $sessionCheckout;
    protected ShippingMethodManagementInterface $shippingMethodManagement;
    protected StoreManagerInterface $_storeManager;
    protected ScopeConfigInterface $scopeConfig;

    public function __construct(
        SessionCheckout $sessionCheckout,
        ShippingMethodManagementInterface $shippingMethodManagement,
        StoreManagerInterface $storeManager,
        ScopeConfigInterface $scopeConfig,
    ) {
        $this->sessionCheckout = $sessionCheckout;
        $this->shippingMethodManagement = $shippingMethodManagement;
        $this->_storeManager = $storeManager;
        $this->scopeConfig = $scopeConfig;
    }

    /**
     * Get all available shipping methods.
     */
    public function getQuoteDetails()
    {
        try {
            $quote = $this->sessionCheckout->getQuote();

            $quoteDetails = [];
            // Include quote ID to detect new checkout sessions and clear stale storage data
            $quoteDetails["quote_id"] = $quote->getId();
            $quoteDetails["email"] = $quote->getCustomerEmail();
            if (!$quoteDetails["email"]) {
                $quoteDetails["email"] = $quote
                    ->getBillingAddress()
                    ->getEmail();
            }

            $quoteDetails["telephone"] = $quote
                ->getShippingAddress()
                ->getTelephone();
            if (!$quoteDetails["telephone"]) {
                $quoteDetails["telephone"] = $quote
                    ->getBillingAddress()
                    ->getTelephone();
            }

            $shippingAddress = $quote->getShippingAddress();
            $quoteDetails[
                "shipping_incl_tax"
            ] = $shippingAddress->getShippingInclTax();
            $quoteDetails[
                "shipping_amount"
            ] = $shippingAddress->getShippingAmount();
            $quoteDetails[
                "shipping_tax_amount"
            ] = $shippingAddress->getShippingTaxAmount();
            $quoteDetails["tax_amount"] = $shippingAddress->getTaxAmount();
            $totals = $quote->getTotals();
            if (isset($totals["grand_total"])) {
                $grandTotal = $totals["grand_total"]->getValue();
                $quoteDetails["grand_total"] = $grandTotal;
            }
            $baseCurrencyCode = $quote->getBaseCurrencyCode();
            $quoteCurrencyCode = $quote->getQuoteCurrencyCode();
            if ($baseCurrencyCode || $quoteCurrencyCode) {
                $quoteDetails["base_currency_code"] = $baseCurrencyCode;
                $quoteDetails["quote_currency_code"] = $quoteCurrencyCode;
            }
            $billingAddress = $quote->getBillingAddress();
            if ($billingAddress) {
                $quoteDetails["country_id"] = $billingAddress->getCountryId();
                $quoteDetails["billing_country_id"] = $billingAddress->getCountryId();
                $quoteDetails["first_name"] = $billingAddress->getFirstname();
                $quoteDetails["last_name"] = $billingAddress->getLastname();
            }

            // Include shipping address country as fallback
            if ($shippingAddress) {
                $quoteDetails["shipping_country_id"] = $shippingAddress->getCountryId();
            }

            // Include store's default country as ultimate fallback for checkouts without country selector
            $defaultCountry = $this->scopeConfig->getValue(
                'general/country/default',
                ScopeInterface::SCOPE_STORE
            );
            $quoteDetails["default_country_id"] = $defaultCountry;

            $quoteItems = $quote->getItems();
            if ($quoteItems) {
                $mediaUrl = $this->_storeManager
                    ->getStore()
                    ->getBaseUrl(
                        \Magento\Framework\UrlInterface::URL_TYPE_MEDIA,
                    );
                $items = [];
                foreach ($quoteItems as $item) {
                    $items[] = [
                        "name" => $item->getName(),
                        "description" => $item->getDescription() ?? "",
                        "discount_amount" => $item->getDiscountAmount(),
                        "row_total_incl_tax" => $item->getRowTotalInclTax(),
                        "row_total" => $item->getRowTotal(),
                        "qty" => $item->getQty(),
                        "price" => $item->getPrice(),
                        "tax_amount" => $item->getTaxAmount(),
                        "tax_percent" => $item->getTaxPercent(),
                        "thumbnail" =>
                            $mediaUrl . $item->getProduct()->getThumbnail(),
                        "is_virtual" => $item->getIsVirtual(),
                    ];
                }
                $quoteDetails["items"] = $items;
            }
            return $quoteDetails;
        } catch (LocalizedException $exception) {
            // Return empty array instead of null to prevent JS errors
            return [];
        }
    }
}
