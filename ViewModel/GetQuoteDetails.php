<?php

declare(strict_types=1);

namespace Two\GatewayHyva\ViewModel;

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
     * The current store view id, resolved INDEPENDENTLY of the quote.
     *
     * getQuoteDetails() returns [] on a LocalizedException, so reading the store
     * id out of that array meant a degraded quote collapsed the company-selection
     * storage key to a single store-less bucket shared by every store view — the
     * cross-store leak the keying exists to prevent, back again and silent.
     * Its own accessor, its own catch, so the two failures cannot be coupled.
     *
     * Returns '' when the store cannot be resolved at all; the JS side treats an
     * empty store id as "no storage", which carries nothing over rather than
     * sharing a bucket.
     */
    public function getCurrentStoreId(): string
    {
        try {
            return (string) $this->_storeManager->getStore()->getId();
        } catch (LocalizedException $exception) {
            return '';
        }
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
            // Cast for the same reason as store_id below: this value is
            // compared, as a string, by TWO separate clearers — one reading it
            // out of json_encode() (where an int stays a number) and one out of
            // an escapeJs()'d PHP string. An int on one side and a string on the
            // other makes `!==` true forever, and the two clearers then wipe the
            // buyer's company on every page load.
            $quoteDetails["quote_id"] = (string) $quote->getId();
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
