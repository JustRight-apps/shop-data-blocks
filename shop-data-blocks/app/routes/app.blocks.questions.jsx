import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  appendMessage,
  deleteThread,
  promoteToFaq,
  readCustomer,
  readInbox,
} from "../blocks/questions/server";
import {
  MESSAGE_AUTHOR,
  QUESTION_STATUS,
} from "../blocks/questions/constants";
import { sendMerchantAnsweredEmail } from "../lib/email.server";

const FILTER_LABELS = {
  all: "All",
  awaiting_merchant: "Awaiting reply",
  awaiting_customer: "Sent",
  promoted: "Promoted",
};

const STATUS_TONE = {
  [QUESTION_STATUS.AWAITING_MERCHANT]: "critical",
  [QUESTION_STATUS.AWAITING_CUSTOMER]: "info",
  [QUESTION_STATUS.PROMOTED]: "success",
};

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const threadId = url.searchParams.get("thread") ?? "";
  const filter = url.searchParams.get("filter") ?? "all";

  const { threads } = await readInbox(admin);
  const selectedRow = threadId ? threads.find((t) => t.id === threadId) : null;

  let selectedThread = null;
  let selectedCustomer = null;
  if (selectedRow) {
    const customer = await readCustomer(admin, selectedRow.customer_id);
    const fullThread = customer.threads.find((t) => t.id === threadId) ?? null;
    if (fullThread) {
      selectedCustomer = { id: customer.id, email: customer.email, name: customer.name };
      selectedThread = fullThread;
    }
  }

  return {
    threads,
    filter,
    selectedThread,
    selectedCustomer,
    shopDomain: session.shop,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const customerId = String(formData.get("customerId") ?? "");
  const threadId = String(formData.get("threadId") ?? "");

  if (!customerId || !threadId) {
    return { intent, ok: false, error: "Missing thread or customer." };
  }

  if (intent === "reply") {
    const text = String(formData.get("text") ?? "");
    let result;
    try {
      result = await appendMessage(admin, {
        customerId,
        threadId,
        author: MESSAGE_AUTHOR.MERCHANT,
        text,
      });
    } catch (error) {
      return { intent, ok: false, error: error.message };
    }

    try {
      if (result.customer.email) {
        const productUrl = `https://${session.shop}/products/${result.thread.product_handle}`;
        const threadUrl = `https://${session.shop}/account`;
        await sendMerchantAnsweredEmail({
          to: result.customer.email,
          customerName: result.customer.name,
          productTitle: result.thread.product_title,
          productUrl,
          answer: text,
          threadUrl,
        });
      }
    } catch (error) {
      console.warn("Failed to send customer notification email:", error.message);
    }

    return { intent, ok: true };
  }

  if (intent === "promote") {
    const question = String(formData.get("question") ?? "");
    const answer = String(formData.get("answer") ?? "");
    try {
      await promoteToFaq(admin, { customerId, threadId, question, answer });
    } catch (error) {
      return { intent, ok: false, error: error.message };
    }
    return { intent, ok: true };
  }

  if (intent === "delete") {
    try {
      await deleteThread(admin, { customerId, threadId });
    } catch (error) {
      return { intent, ok: false, error: error.message };
    }
    return { intent, ok: true };
  }

  return { intent, ok: false, error: `Unknown intent: ${intent}` };
};

function formatTimestamp(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso ?? "";
  }
}

export default function QuestionsInbox() {
  const data = useLoaderData();
  const fetcher = useFetcher();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  const [replyDraft, setReplyDraft] = useState("");
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteQuestion, setPromoteQuestion] = useState("");
  const [promoteAnswer, setPromoteAnswer] = useState("");

  const selectedId = data.selectedThread?.id ?? null;

  useEffect(() => {
    setReplyDraft("");
    setPromoteOpen(false);
  }, [selectedId]);

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.ok) {
      const msg =
        fetcher.data.intent === "reply"
          ? "Reply sent"
          : fetcher.data.intent === "promote"
            ? "Promoted to FAQ"
            : fetcher.data.intent === "delete"
              ? "Thread deleted"
              : "Saved";
      shopify.toast.show(msg);
      if (fetcher.data.intent === "reply") setReplyDraft("");
      if (fetcher.data.intent === "promote") setPromoteOpen(false);
    } else if (fetcher.data.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const filteredThreads = useMemo(() => {
    if (data.filter === "all") return data.threads;
    return data.threads.filter((t) => t.status === data.filter);
  }, [data.threads, data.filter]);

  const isBusy = fetcher.state !== "idle";
  const isNavigating = navigation.state === "loading";

  const lastMerchantMessage = data.selectedThread?.messages
    ?.slice()
    .reverse()
    .find((m) => m.author === MESSAGE_AUTHOR.MERCHANT);
  const firstCustomerMessage = data.selectedThread?.messages?.find(
    (m) => m.author === MESSAGE_AUTHOR.CUSTOMER,
  );

  const openPromote = () => {
    setPromoteQuestion(firstCustomerMessage?.text ?? "");
    setPromoteAnswer(lastMerchantMessage?.text ?? "");
    setPromoteOpen(true);
  };

  const submitReply = () => {
    if (!replyDraft.trim()) return;
    const formData = new FormData();
    formData.set("intent", "reply");
    formData.set("customerId", data.selectedCustomer.id);
    formData.set("threadId", selectedId);
    formData.set("text", replyDraft);
    fetcher.submit(formData, { method: "POST" });
  };

  const submitPromote = () => {
    const formData = new FormData();
    formData.set("intent", "promote");
    formData.set("customerId", data.selectedCustomer.id);
    formData.set("threadId", selectedId);
    formData.set("question", promoteQuestion);
    formData.set("answer", promoteAnswer);
    fetcher.submit(formData, { method: "POST" });
  };

  const submitDelete = async () => {
    const confirmed = await shopify.confirm({
      message: "Delete this thread? This cannot be undone.",
      confirmType: "destructive",
    });
    if (!confirmed) return;
    const formData = new FormData();
    formData.set("intent", "delete");
    formData.set("customerId", data.selectedCustomer.id);
    formData.set("threadId", selectedId);
    fetcher.submit(formData, { method: "POST" });
  };

  return (
    <s-page heading="Customer Questions">
      <s-stack direction="inline" gap="base" align-items="flex-start" inline-size="100%">
        <s-box inline-size="35%" min-inline-size="280px">
          <s-section heading="Inbox">
            <s-stack direction="block" gap="tight">
              <s-stack direction="inline" gap="tight">
                {Object.entries(FILTER_LABELS).map(([key, label]) => (
                  <s-button
                    key={key}
                    variant={data.filter === key ? "primary" : "tertiary"}
                    href={`/app/blocks/questions?filter=${key}${selectedId ? `&thread=${selectedId}` : ""}`}
                  >
                    {label}
                  </s-button>
                ))}
              </s-stack>

              {filteredThreads.length === 0 ? (
                <s-paragraph>No questions in this view yet.</s-paragraph>
              ) : (
                <s-stack direction="block" gap="tight">
                  {filteredThreads.map((row) => {
                    const isActive = row.id === selectedId;
                    return (
                      <s-clickable
                        key={row.id}
                        href={`/app/blocks/questions?thread=${row.id}&filter=${data.filter}`}
                      >
                        <s-box
                          padding="base"
                          background={isActive ? "subdued" : "transparent"}
                          border-radius="base"
                        >
                          <s-stack direction="block" gap="extra-tight">
                            <s-stack direction="inline" gap="tight" align-items="center">
                              <s-text type="strong">{row.customer_name || row.customer_email}</s-text>
                              <s-badge tone={STATUS_TONE[row.status] ?? "neutral"}>
                                {row.status.replace("_", " ")}
                              </s-badge>
                            </s-stack>
                            <s-text>{row.product_title}</s-text>
                            <s-text tone="subdued">{row.snippet}</s-text>
                            <s-text tone="subdued" size="small">
                              {formatTimestamp(row.last_message_at)}
                            </s-text>
                          </s-stack>
                        </s-box>
                      </s-clickable>
                    );
                  })}
                </s-stack>
              )}
            </s-stack>
          </s-section>
        </s-box>

        <s-box inline-size="65%" min-inline-size="0">
          {!selectedId ? (
            <s-section heading="Select a question">
              <s-paragraph>
                Pick a question from the inbox to see the full conversation and reply.
              </s-paragraph>
            </s-section>
          ) : isNavigating || !data.selectedThread ? (
            <s-section>
              <s-spinner accessibilityLabel="Loading thread" size="large" />
            </s-section>
          ) : (
            <s-stack direction="block" gap="base">
              <s-section heading={data.selectedThread.product_title}>
                <s-stack direction="block" gap="tight">
                  <s-stack direction="inline" gap="tight" align-items="center">
                    <s-text type="strong">{data.selectedCustomer.name}</s-text>
                    {data.selectedCustomer.email ? (
                      <s-text tone="subdued">&lt;{data.selectedCustomer.email}&gt;</s-text>
                    ) : null}
                    <s-badge tone={STATUS_TONE[data.selectedThread.status] ?? "neutral"}>
                      {data.selectedThread.status.replace("_", " ")}
                    </s-badge>
                  </s-stack>
                  <s-link
                    href={`https://${data.shopDomain}/products/${data.selectedThread.product_handle}`}
                    target="_blank"
                  >
                    View product
                  </s-link>
                </s-stack>
              </s-section>

              <s-section heading="Conversation">
                <s-stack direction="block" gap="base">
                  {data.selectedThread.messages.map((m) => (
                    <s-box
                      key={m.id}
                      padding="base"
                      border-radius="base"
                      background={m.author === MESSAGE_AUTHOR.MERCHANT ? "info-subdued" : "subdued"}
                    >
                      <s-stack direction="block" gap="extra-tight">
                        <s-stack direction="inline" gap="tight">
                          <s-text type="strong">
                            {m.author === MESSAGE_AUTHOR.MERCHANT ? "You" : data.selectedCustomer.name}
                          </s-text>
                          <s-text tone="subdued" size="small">
                            {formatTimestamp(m.created_at)}
                          </s-text>
                        </s-stack>
                        <s-paragraph>{m.text}</s-paragraph>
                      </s-stack>
                    </s-box>
                  ))}
                </s-stack>
              </s-section>

              {data.selectedThread.status !== QUESTION_STATUS.PROMOTED && (
                <s-section heading="Reply">
                  <s-stack direction="block" gap="base">
                    <s-text-area
                      label="Your reply"
                      value={replyDraft}
                      onChange={(e) => setReplyDraft(e.target.value)}
                      rows={5}
                      maxLength={2000}
                      placeholder="The customer will receive this by email."
                    />
                    <s-stack direction="inline" gap="tight">
                      <s-button
                        variant="primary"
                        onClick={submitReply}
                        disabled={!replyDraft.trim() || isBusy}
                      >
                        Send reply
                      </s-button>
                      {lastMerchantMessage ? (
                        <s-button onClick={openPromote} disabled={isBusy}>
                          Promote to FAQ
                        </s-button>
                      ) : null}
                      <s-button variant="tertiary" tone="critical" onClick={submitDelete} disabled={isBusy}>
                        Delete
                      </s-button>
                    </s-stack>
                  </s-stack>
                </s-section>
              )}

              {promoteOpen && (
                <s-section heading="Promote to product FAQ">
                  <s-stack direction="block" gap="base">
                    <s-paragraph>
                      This will append the Q&amp;A below to this product&apos;s FAQ list. Edit before saving if you want a cleaner phrasing.
                    </s-paragraph>
                    <s-text-area
                      label="Question"
                      value={promoteQuestion}
                      onChange={(e) => setPromoteQuestion(e.target.value)}
                      rows={2}
                    />
                    <s-text-area
                      label="Answer"
                      value={promoteAnswer}
                      onChange={(e) => setPromoteAnswer(e.target.value)}
                      rows={4}
                    />
                    <s-stack direction="inline" gap="tight">
                      <s-button
                        variant="primary"
                        onClick={submitPromote}
                        disabled={!promoteQuestion.trim() || !promoteAnswer.trim() || isBusy}
                      >
                        Add to FAQ
                      </s-button>
                      <s-button variant="tertiary" onClick={() => setPromoteOpen(false)}>
                        Cancel
                      </s-button>
                    </s-stack>
                  </s-stack>
                </s-section>
              )}
            </s-stack>
          )}
        </s-box>
      </s-stack>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
