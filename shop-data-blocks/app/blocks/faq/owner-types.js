export const FAQ_NAMESPACE = "$app";
export const FAQ_KEY = "faq";
export const FAQ_TYPE = "json";

export const OWNER_TYPES = {
  PRODUCT: {
    id: "PRODUCT",
    label: "Product",
    metafieldOwnerType: "PRODUCT",
    gidPrefix: "gid://shopify/Product/",
    pickerType: "product",
  },
  PRODUCTVARIANT: {
    id: "PRODUCTVARIANT",
    label: "Variant",
    metafieldOwnerType: "PRODUCTVARIANT",
    gidPrefix: "gid://shopify/ProductVariant/",
    pickerType: "variant",
  },
  COLLECTION: {
    id: "COLLECTION",
    label: "Collection",
    metafieldOwnerType: "COLLECTION",
    gidPrefix: "gid://shopify/Collection/",
    pickerType: "collection",
  },
  SHOP: {
    id: "SHOP",
    label: "Shop",
    metafieldOwnerType: "SHOP",
    gidPrefix: "gid://shopify/Shop/",
    pickerType: null,
  },
  MARKET: {
    id: "MARKET",
    label: "Market",
    metafieldOwnerType: "MARKET",
    gidPrefix: "gid://shopify/Market/",
    pickerType: null,
  },
  BLOG: {
    id: "BLOG",
    label: "Blog",
    metafieldOwnerType: "BLOG",
    gidPrefix: "gid://shopify/OnlineStoreBlog/",
    pickerType: null,
  },
  ARTICLE: {
    id: "ARTICLE",
    label: "Article",
    metafieldOwnerType: "ARTICLE",
    gidPrefix: "gid://shopify/OnlineStoreArticle/",
    pickerType: null,
  },
};

export function getOwnerType(id) {
  return OWNER_TYPES[id] ?? null;
}
