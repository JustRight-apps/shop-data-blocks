import {
  CUSTOMER_QUESTIONS_KEY,
  MAX_MESSAGE_LENGTH,
  MESSAGE_AUTHOR,
  QUESTION_INBOX_KEY,
  QUESTION_STATUS,
  QUESTIONS_NAMESPACE,
  QUESTIONS_TYPE,
  deriveStatusFromMessages,
  makeSnippet,
  newId,
} from "./constants";
import { bulkWriteFaq, readFaq } from "../faq/metafield.server";

const SHOP_QUERY = `#graphql
  query QuestionsShop {
    shop { id name email url }
  }
`;

const CUSTOMER_QUERY = `#graphql
  query QuestionsCustomer($id: ID!) {
    customer(id: $id) {
      id
      email
      firstName
      lastName
      displayName
      metafield(namespace: "$app", key: "product_questions") { jsonValue }
    }
  }
`;

const PRODUCT_QUERY = `#graphql
  query QuestionsProduct($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      onlineStoreUrl
    }
  }
`;

const METAFIELDS_SET = `#graphql
  mutation QuestionsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message }
    }
  }
`;

export async function getShop(admin) {
  const response = await admin.graphql(SHOP_QUERY);
  const json = await response.json();
  return json.data.shop;
}

export async function readInbox(admin) {
  const response = await admin.graphql(`#graphql
    query QuestionInbox {
      shop {
        id
        metafield(namespace: "$app", key: "question_inbox") { jsonValue }
      }
    }
  `);
  const json = await response.json();
  const shop = json.data.shop;
  const value = shop.metafield?.jsonValue ?? null;
  const threads = Array.isArray(value?.threads) ? value.threads : [];
  return { shopId: shop.id, threads };
}

async function writeInbox(admin, shopId, threads) {
  const response = await admin.graphql(METAFIELDS_SET, {
    variables: {
      metafields: [
        {
          ownerId: shopId,
          namespace: QUESTIONS_NAMESPACE,
          key: QUESTION_INBOX_KEY,
          type: QUESTIONS_TYPE,
          value: JSON.stringify({ threads }),
        },
      ],
    },
  });
  const json = await response.json();
  const errs = json.data?.metafieldsSet?.userErrors ?? [];
  if (errs.length) throw new Error(`Inbox write failed: ${errs.map((e) => e.message).join(", ")}`);
}

export async function readCustomer(admin, customerId) {
  const response = await admin.graphql(CUSTOMER_QUERY, {
    variables: { id: customerId },
  });
  const json = await response.json();
  const customer = json.data?.customer;
  if (!customer) throw new Error(`Customer not found: ${customerId}`);
  const value = customer.metafield?.jsonValue ?? null;
  const threads = Array.isArray(value?.threads) ? value.threads : [];
  return {
    id: customer.id,
    email: customer.email,
    name: customer.displayName || [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.email,
    threads,
  };
}

async function writeCustomerThreads(admin, customerId, threads) {
  const response = await admin.graphql(METAFIELDS_SET, {
    variables: {
      metafields: [
        {
          ownerId: customerId,
          namespace: QUESTIONS_NAMESPACE,
          key: CUSTOMER_QUESTIONS_KEY,
          type: QUESTIONS_TYPE,
          value: JSON.stringify({ threads }),
        },
      ],
    },
  });
  const json = await response.json();
  const errs = json.data?.metafieldsSet?.userErrors ?? [];
  if (errs.length) throw new Error(`Customer write failed: ${errs.map((e) => e.message).join(", ")}`);
}

async function readProduct(admin, productId) {
  const response = await admin.graphql(PRODUCT_QUERY, {
    variables: { id: productId },
  });
  const json = await response.json();
  const product = json.data?.product;
  if (!product) throw new Error(`Product not found: ${productId}`);
  return product;
}

function validateText(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed.length < 1) throw new Error("Message cannot be empty.");
  if (trimmed.length > MAX_MESSAGE_LENGTH)
    throw new Error(`Message exceeds ${MAX_MESSAGE_LENGTH} characters.`);
  return trimmed;
}

function buildMessage(author, text) {
  return {
    id: newId("m"),
    author,
    text,
    created_at: new Date().toISOString(),
  };
}

export async function appendQuestion(admin, { customerId, productId, text }) {
  const cleanedText = validateText(text);
  const [customer, product, inbox] = await Promise.all([
    readCustomer(admin, customerId),
    readProduct(admin, productId),
    readInbox(admin),
  ]);

  const now = new Date().toISOString();
  const message = buildMessage(MESSAGE_AUTHOR.CUSTOMER, cleanedText);
  const thread = {
    id: newId("q"),
    product_id: product.id,
    product_handle: product.handle,
    product_title: product.title,
    messages: [message],
    status: QUESTION_STATUS.AWAITING_MERCHANT,
    asked_at: now,
    last_message_at: now,
    promoted_to_faq: false,
  };

  const newCustomerThreads = [thread, ...customer.threads];
  const inboxRow = {
    id: thread.id,
    customer_id: customer.id,
    customer_email: customer.email,
    customer_name: customer.name,
    product_id: product.id,
    product_title: product.title,
    snippet: makeSnippet(cleanedText),
    status: QUESTION_STATUS.AWAITING_MERCHANT,
    asked_at: now,
    last_message_at: now,
  };
  const newInboxThreads = [inboxRow, ...inbox.threads];

  await Promise.all([
    writeCustomerThreads(admin, customer.id, newCustomerThreads),
    writeInbox(admin, inbox.shopId, newInboxThreads),
  ]);

  return { thread, customer, product };
}

export async function appendMessage(admin, { customerId, threadId, author, text }) {
  const cleanedText = validateText(text);
  const [customer, inbox] = await Promise.all([
    readCustomer(admin, customerId),
    readInbox(admin),
  ]);

  const threadIdx = customer.threads.findIndex((t) => t.id === threadId);
  if (threadIdx === -1) throw new Error(`Thread not found: ${threadId}`);
  const thread = customer.threads[threadIdx];

  if (thread.status === QUESTION_STATUS.PROMOTED) {
    throw new Error("Cannot reply to a promoted thread.");
  }

  const message = buildMessage(author, cleanedText);
  const updatedMessages = [...thread.messages, message];
  const now = message.created_at;
  const status = deriveStatusFromMessages(updatedMessages);

  const updatedThread = {
    ...thread,
    messages: updatedMessages,
    status,
    last_message_at: now,
  };

  const newCustomerThreads = customer.threads.map((t, i) =>
    i === threadIdx ? updatedThread : t,
  );

  const inboxIdx = inbox.threads.findIndex((row) => row.id === threadId);
  if (inboxIdx === -1) {
    throw new Error(`Inbox row not found for thread ${threadId}`);
  }
  const updatedInboxRow = {
    ...inbox.threads[inboxIdx],
    status,
    snippet: makeSnippet(cleanedText),
    last_message_at: now,
  };
  const newInboxThreads = inbox.threads.map((row, i) =>
    i === inboxIdx ? updatedInboxRow : row,
  );

  await Promise.all([
    writeCustomerThreads(admin, customer.id, newCustomerThreads),
    writeInbox(admin, inbox.shopId, newInboxThreads),
  ]);

  return { thread: updatedThread, customer };
}

export async function promoteToFaq(admin, { customerId, threadId, question, answer }) {
  const cleanedQuestion = String(question ?? "").trim();
  const cleanedAnswer = String(answer ?? "").trim();
  if (!cleanedQuestion || !cleanedAnswer) {
    throw new Error("Both question and answer are required to promote.");
  }

  const [customer, inbox] = await Promise.all([
    readCustomer(admin, customerId),
    readInbox(admin),
  ]);

  const threadIdx = customer.threads.findIndex((t) => t.id === threadId);
  if (threadIdx === -1) throw new Error(`Thread not found: ${threadId}`);
  const thread = customer.threads[threadIdx];

  const existingFaq = await readFaq(admin, "PRODUCT", thread.product_id);
  const mergedItems = [
    ...existingFaq.items,
    { question: cleanedQuestion, answer: cleanedAnswer },
  ];

  const faqResult = await bulkWriteFaq(admin, [
    { ownerType: "PRODUCT", ownerId: thread.product_id, items: mergedItems },
  ]);
  if (faqResult.userErrors?.length) {
    throw new Error(
      `FAQ write failed: ${faqResult.userErrors.map((e) => e.message).join(", ")}`,
    );
  }

  const updatedThread = {
    ...thread,
    status: QUESTION_STATUS.PROMOTED,
    promoted_to_faq: true,
  };
  const newCustomerThreads = customer.threads.map((t, i) =>
    i === threadIdx ? updatedThread : t,
  );

  const inboxIdx = inbox.threads.findIndex((row) => row.id === threadId);
  const newInboxThreads =
    inboxIdx === -1
      ? inbox.threads
      : inbox.threads.map((row, i) =>
          i === inboxIdx ? { ...row, status: QUESTION_STATUS.PROMOTED } : row,
        );

  await Promise.all([
    writeCustomerThreads(admin, customer.id, newCustomerThreads),
    writeInbox(admin, inbox.shopId, newInboxThreads),
  ]);

  return { thread: updatedThread };
}

export async function deleteThread(admin, { customerId, threadId }) {
  const [customer, inbox] = await Promise.all([
    readCustomer(admin, customerId),
    readInbox(admin),
  ]);

  const newCustomerThreads = customer.threads.filter((t) => t.id !== threadId);
  const newInboxThreads = inbox.threads.filter((row) => row.id !== threadId);

  await Promise.all([
    writeCustomerThreads(admin, customer.id, newCustomerThreads),
    writeInbox(admin, inbox.shopId, newInboxThreads),
  ]);
}
