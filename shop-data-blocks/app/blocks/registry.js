export const blocks = [
  {
    id: "faq",
    title: "FAQs",
    description:
      "Attach a list of frequently asked questions to a product, variant, collection, blog, article, market, or your shop. Renders on the storefront with FAQPage structured data for SEO.",
    editorPath: "/app/blocks/faq",
    scopes: [
      { value: "PRODUCT", label: "Product", icon: "product" },
      { value: "PRODUCTVARIANT", label: "Variant", icon: "variant" },
      { value: "COLLECTION", label: "Collection", icon: "collection" },
      { value: "SHOP", label: "Shop", icon: "store" },
      { value: "MARKET", label: "Market", icon: "markets" },
      { value: "BLOG", label: "Blog", icon: "blog" },
      { value: "ARTICLE", label: "Article", icon: "page" },
    ],
  },
];
