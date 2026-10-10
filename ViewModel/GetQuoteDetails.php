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
     * An opaque fingerprint of the totals an order intent is priced on
     * (TWO-26296).
     *
     * The base module prices the intent from the quote when the request
     * arrives, so a check made before shipping and tax were known is priced on
     * a basket the order will not have. The tile renders this key outside its
     * re-render-ignored form, so every re-render carries the current one, and
     * checks again when it differs from the key its last check was sent under.
     * Hashed so the page still carries no amounts (TWO-26092). Both addresses
     * are read because a virtual quote keeps its totals on the billing one,
     * and each address's country with them, which the intent is sent under.
     *
     * Returns '' when the quote cannot be loaded; the tile then never sees a
     * change and behaves as it did before the key existed.
     */
    public function getIntentBasketKey(): string
    {
        try {
            $quote = $this->sessionCheckout->getQuote();
        } catch (LocalizedException $exception) {
            return '';
        }

        $parts = [
            (string) $quote->getQuoteCurrencyCode(),
            sprintf('%.4F', (float) $quote->getGrandTotal()),
            (string) $quote->getItemsQty(),
        ];
        foreach ([$quote->getBillingAddress(), $quote->getShippingAddress()] as $address) {
            if (!$address) {
                $parts[] = '-';
                continue;
            }
            // The intent goes out under the address's country too, so a move
            // that changes nothing else is still a different check.
            $parts[] = (string) $address->getCountryId();
            $parts[] = sprintf('%.4F', (float) $address->getTaxAmount());
            $parts[] = sprintf('%.4F', (float) $address->getShippingAmount());
            $parts[] = (string) $address->getShippingMethod();
        }

        return hash('sha256', implode('|', $parts));
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

            return $quoteDetails;
        } catch (LocalizedException $exception) {
            // Return empty array instead of null to prevent JS errors
            return [];
        }
    }

    /**
     * The quote's billing and shipping countries as they are now (TWO-26295).
     *
     * getQuoteDetails() feeds the payment tile's form, which re-render ignores,
     * so its countries are the ones from page load. A logged-in buyer who
     * picks a saved address has no country field on the page to read
     * instead, so the tile reads these, rendered outside that form on every
     * re-render, to know the country the order intent goes out under.
     *
     * @return array{billing: string, shipping: string}
     */
    public function getLiveAddressCountries(): array
    {
        try {
            $quote = $this->sessionCheckout->getQuote();
        } catch (LocalizedException $exception) {
            return ['billing' => '', 'shipping' => ''];
        }
        $billing = $quote->getBillingAddress();
        $shipping = $quote->getShippingAddress();

        return [
            'billing' => $billing ? (string) $billing->getCountryId() : '',
            'shipping' => $shipping ? (string) $shipping->getCountryId() : '',
        ];
    }
}
