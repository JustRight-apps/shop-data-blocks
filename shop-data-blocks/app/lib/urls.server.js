export function merchantInboxUrl(shopDomain) {
  return `https://${shopDomain}/admin/apps/${process.env.SHOPIFY_API_KEY}/app/blocks/questions`;
}

export function productStorefrontUrl(shopDomain, productHandle) {
  return `https://${shopDomain}/products/${productHandle}`;
}

export function customerAccountUrl(shopDomain) {
  return `https://${shopDomain}/account`;
}
