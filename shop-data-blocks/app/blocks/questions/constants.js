export const QUESTIONS_NAMESPACE = "$app";
export const CUSTOMER_QUESTIONS_KEY = "product_questions";
export const QUESTION_INBOX_KEY = "question_inbox";
export const QUESTIONS_TYPE = "json";

export const QUESTION_STATUS = {
  AWAITING_MERCHANT: "awaiting_merchant",
  AWAITING_CUSTOMER: "awaiting_customer",
  PROMOTED: "promoted",
};

export const MESSAGE_AUTHOR = {
  CUSTOMER: "customer",
  MERCHANT: "merchant",
};

export const MAX_MESSAGE_LENGTH = 2000;
export const SNIPPET_LENGTH = 120;

export function deriveStatusFromMessages(messages, promoted = false) {
  if (promoted) return QUESTION_STATUS.PROMOTED;
  const last = messages[messages.length - 1];
  if (!last) return QUESTION_STATUS.AWAITING_MERCHANT;
  return last.author === MESSAGE_AUTHOR.CUSTOMER
    ? QUESTION_STATUS.AWAITING_MERCHANT
    : QUESTION_STATUS.AWAITING_CUSTOMER;
}

export function makeSnippet(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed.length <= SNIPPET_LENGTH) return trimmed;
  return `${trimmed.slice(0, SNIPPET_LENGTH - 1)}…`;
}

let idCounter = 0;
export function newId(prefix) {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}
