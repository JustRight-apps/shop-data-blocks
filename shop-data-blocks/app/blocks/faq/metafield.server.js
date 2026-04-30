import { FAQ_KEY, FAQ_NAMESPACE, FAQ_TYPE } from "./owner-types";

const RESOURCE_QUERY_BY_TYPE = {
  PRODUCT: `query Faq($id: ID!) {
    node(id: $id) { ... on Product { id title metafield(namespace: "$app", key: "faq") { jsonValue } } }
  }`,
  PRODUCTVARIANT: `query Faq($id: ID!) {
    node(id: $id) { ... on ProductVariant { id title displayName product { title } metafield(namespace: "$app", key: "faq") { jsonValue } } }
  }`,
  COLLECTION: `query Faq($id: ID!) {
    node(id: $id) { ... on Collection { id title metafield(namespace: "$app", key: "faq") { jsonValue } } }
  }`,
  MARKET: `query Faq($id: ID!) {
    node(id: $id) { ... on Market { id name metafield(namespace: "$app", key: "faq") { jsonValue } } }
  }`,
  BLOG: `query Faq($id: ID!) {
    node(id: $id) { ... on Blog { id title metafield(namespace: "$app", key: "faq") { jsonValue } } }
  }`,
  ARTICLE: `query Faq($id: ID!) {
    node(id: $id) { ... on Article { id title blog { title } metafield(namespace: "$app", key: "faq") { jsonValue } } }
  }`,
};

const RESOURCE_LABEL_BY_TYPE = {
  PRODUCT: (node) => node.title,
  PRODUCTVARIANT: (node) => node.displayName ?? `${node.product?.title ?? "Variant"} — ${node.title}`,
  COLLECTION: (node) => node.title,
  MARKET: (node) => node.name,
  BLOG: (node) => node.title,
  ARTICLE: (node) => `${node.blog?.title ? `${node.blog.title} — ` : ""}${node.title}`,
};

export async function getCurrentShop(admin) {
  const response = await admin.graphql(`#graphql
    query CurrentShop {
      shop {
        id
        name
        metafield(namespace: "$app", key: "faq") { jsonValue }
      }
    }
  `);
  const json = await response.json();
  return json.data.shop;
}

export async function readFaq(admin, ownerType, ownerId) {
  if (ownerType === "SHOP") {
    const shop = await getCurrentShop(admin);
    return {
      ownerId: shop.id,
      ownerLabel: shop.name,
      items: shop.metafield?.jsonValue?.items ?? [],
    };
  }

  const query = RESOURCE_QUERY_BY_TYPE[ownerType];
  if (!query) throw new Error(`Unsupported owner type: ${ownerType}`);

  const response = await admin.graphql(query, { variables: { id: ownerId } });
  const json = await response.json();
  const node = json.data?.node;
  if (!node) {
    return { ownerId, ownerLabel: null, items: [] };
  }

  return {
    ownerId: node.id,
    ownerLabel: RESOURCE_LABEL_BY_TYPE[ownerType](node),
    items: node.metafield?.jsonValue?.items ?? [],
  };
}

const SEARCH_PAGE_SIZE = 50;

const SEARCH_QUERIES = {
  PRODUCT: `query SearchProducts($query: String) {
    products(first: ${SEARCH_PAGE_SIZE}, query: $query) {
      nodes {
        id
        title
        featuredMedia { preview { image { url altText } } }
      }
    }
  }`,
  PRODUCTVARIANT: `query SearchVariants($query: String) {
    productVariants(first: ${SEARCH_PAGE_SIZE}, query: $query) {
      nodes {
        id
        displayName
        image { url altText }
        product {
          featuredMedia { preview { image { url altText } } }
        }
      }
    }
  }`,
  COLLECTION: `query SearchCollections($query: String) {
    collections(first: ${SEARCH_PAGE_SIZE}, query: $query) {
      nodes {
        id
        title
        image { url altText }
      }
    }
  }`,
  BLOG: `query SearchBlogs($query: String) {
    blogs(first: ${SEARCH_PAGE_SIZE}, query: $query) {
      nodes { id title }
    }
  }`,
  ARTICLE: `query SearchArticles($query: String) {
    articles(first: ${SEARCH_PAGE_SIZE}, query: $query) {
      nodes {
        id
        title
        blog { title }
        image { url altText }
      }
    }
  }`,
  MARKET: `query SearchMarkets {
    markets(first: ${SEARCH_PAGE_SIZE}) {
      nodes { id name }
    }
  }`,
};

export async function searchOwners(admin, ownerType, q) {
  if (ownerType === "SHOP") {
    const shop = await getCurrentShop(admin);
    return [{ id: shop.id, label: shop.name }];
  }

  const query = SEARCH_QUERIES[ownerType];
  if (!query) return [];

  const variables =
    ownerType === "MARKET" ? {} : { query: q && q.trim() ? q.trim() : null };

  const response = await admin.graphql(query, { variables });
  const json = await response.json();

  if (ownerType === "PRODUCT") {
    return json.data.products.nodes.map((n) => ({
      id: n.id,
      label: n.title,
      imageUrl: n.featuredMedia?.preview?.image?.url ?? null,
      imageAlt: n.featuredMedia?.preview?.image?.altText ?? n.title,
    }));
  }
  if (ownerType === "PRODUCTVARIANT") {
    return json.data.productVariants.nodes.map((n) => {
      const image = n.image ?? n.product?.featuredMedia?.preview?.image;
      return {
        id: n.id,
        label: n.displayName,
        imageUrl: image?.url ?? null,
        imageAlt: image?.altText ?? n.displayName,
      };
    });
  }
  if (ownerType === "COLLECTION") {
    return json.data.collections.nodes.map((n) => ({
      id: n.id,
      label: n.title,
      imageUrl: n.image?.url ?? null,
      imageAlt: n.image?.altText ?? n.title,
    }));
  }
  if (ownerType === "BLOG") {
    return json.data.blogs.nodes.map((n) => ({
      id: n.id,
      label: n.title,
      imageUrl: null,
      imageAlt: n.title,
    }));
  }
  if (ownerType === "ARTICLE") {
    return json.data.articles.nodes.map((n) => ({
      id: n.id,
      label: `${n.blog?.title ? `${n.blog.title} — ` : ""}${n.title}`,
      imageUrl: n.image?.url ?? null,
      imageAlt: n.image?.altText ?? n.title,
    }));
  }
  if (ownerType === "MARKET") {
    const term = (q ?? "").toLowerCase();
    return json.data.markets.nodes
      .filter((n) => !term || n.name.toLowerCase().includes(term))
      .map((n) => ({
        id: n.id,
        label: n.name,
        imageUrl: null,
        imageAlt: n.name,
      }));
  }
  return [];
}

export async function bulkWriteFaq(admin, changes) {
  if (!changes.length) {
    return { metafields: [], userErrors: [] };
  }
  const response = await admin.graphql(
    `#graphql
      mutation SetFaq($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id namespace key ownerType }
          userErrors { field message }
        }
      }
    `,
    {
      variables: {
        metafields: changes.map(({ ownerId, items }) => ({
          ownerId,
          namespace: FAQ_NAMESPACE,
          key: FAQ_KEY,
          type: FAQ_TYPE,
          value: JSON.stringify({ items }),
        })),
      },
    },
  );
  const json = await response.json();
  return json.data.metafieldsSet;
}
