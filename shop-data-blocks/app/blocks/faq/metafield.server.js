import { FAQ_KEY, FAQ_NAMESPACE, FAQ_TYPE } from "./owner-types";

const RESOURCE_QUERY_BY_TYPE = {
  PRODUCT: `query Faq($id: ID!) {
    node(id: $id) { ... on Product { id title metafield(namespace: "$app", key: "faq") { jsonValue } } }
  }`,
  PRODUCTVARIANT: `query Faq($id: ID!) {
    node(id: $id) { ... on ProductVariant { id title product { title } metafield(namespace: "$app", key: "faq") { jsonValue } } }
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
    node(id: $id) { ... on Article { id title metafield(namespace: "$app", key: "faq") { jsonValue } } }
  }`,
};

const RESOURCE_LABEL_BY_TYPE = {
  PRODUCT: (node) => node.title,
  PRODUCTVARIANT: (node) => `${node.product?.title ?? "Variant"} — ${node.title}`,
  COLLECTION: (node) => node.title,
  MARKET: (node) => node.name,
  BLOG: (node) => node.title,
  ARTICLE: (node) => node.title,
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

  const label = RESOURCE_LABEL_BY_TYPE[ownerType](node);
  return {
    ownerId: node.id,
    ownerLabel: label,
    items: node.metafield?.jsonValue?.items ?? [],
  };
}

export async function writeFaq(admin, ownerId, items) {
  const response = await admin.graphql(
    `#graphql
      mutation SetFaq($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id namespace key type }
          userErrors { field message }
        }
      }
    `,
    {
      variables: {
        metafields: [
          {
            ownerId,
            namespace: FAQ_NAMESPACE,
            key: FAQ_KEY,
            type: FAQ_TYPE,
            value: JSON.stringify({ items }),
          },
        ],
      },
    },
  );
  const json = await response.json();
  return json.data.metafieldsSet;
}

const SEARCH_QUERIES = {
  BLOG: `query SearchBlogs($query: String!) {
    blogs(first: 20, query: $query) { nodes { id title } }
  }`,
  ARTICLE: `query SearchArticles($query: String!) {
    articles(first: 20, query: $query) { nodes { id title blog { title } } }
  }`,
  MARKET: `query SearchMarkets {
    markets(first: 50) { nodes { id name } }
  }`,
};

export async function searchOwners(admin, ownerType, q) {
  const query = SEARCH_QUERIES[ownerType];
  if (!query) return [];

  const response = await admin.graphql(query, {
    variables: ownerType === "MARKET" ? {} : { query: q ? `title:*${q}*` : "" },
  });
  const json = await response.json();

  if (ownerType === "BLOG") {
    return json.data.blogs.nodes.map((n) => ({ id: n.id, label: n.title }));
  }
  if (ownerType === "ARTICLE") {
    return json.data.articles.nodes.map((n) => ({
      id: n.id,
      label: `${n.blog?.title ? `${n.blog.title} — ` : ""}${n.title}`,
    }));
  }
  if (ownerType === "MARKET") {
    const term = (q ?? "").toLowerCase();
    return json.data.markets.nodes
      .filter((n) => !term || n.name.toLowerCase().includes(term))
      .map((n) => ({ id: n.id, label: n.name }));
  }
  return [];
}
