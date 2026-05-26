import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

const API_BASE = "https://just-right.net";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const { i18n } = shopify;
  const t = (key) => i18n.translate(key);

  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);

  const loadThreads = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const token = await shopify.sessionToken.get();
      const response = await fetch(`${API_BASE}/customer-api/threads`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setThreads(Array.isArray(data.threads) ? data.threads : []);
    } catch (error) {
      setLoadError(error.message || t("loadError"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadThreads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sortedThreads = useMemo(
    () =>
      [...threads].sort((a, b) =>
        String(b.last_message_at).localeCompare(String(a.last_message_at)),
      ),
    [threads],
  );

  const expanded = expandedId
    ? sortedThreads.find((t) => t.id === expandedId)
    : null;

  const onToggle = (id) => {
    setExpandedId((current) => (current === id ? null : id));
    setReplyText("");
    setSendError(null);
  };

  const onSendReply = async () => {
    if (!expanded || !replyText.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      const token = await shopify.sessionToken.get();
      const response = await fetch(`${API_BASE}/customer-api/reply`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ thread_id: expanded.id, text: replyText }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        throw new Error(data.error || t("replyError"));
      }
      setReplyText("");
      await loadThreads();
    } catch (error) {
      setSendError(error.message || t("replyError"));
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <s-section heading={t("name")}>
        <s-spinner accessibilityLabel={t("loadingAccessibility")} />
      </s-section>
    );
  }

  if (loadError) {
    return (
      <s-section heading={t("name")}>
        <s-banner tone="critical">{loadError}</s-banner>
      </s-section>
    );
  }

  if (!sortedThreads.length) {
    return (
      <s-section heading={t("name")}>
        <s-paragraph>{t("emptyState")}</s-paragraph>
      </s-section>
    );
  }

  return (
    <s-section heading={t("name")}>
      <s-stack direction="block" gap="base">
        {sortedThreads.map((thread) => {
          const isExpanded = expandedId === thread.id;
          const statusKey = `status_${thread.status}`;
          return (
            <s-box
              key={thread.id}
              padding="base"
              border-radius="base"
              border="base"
            >
              <s-stack direction="block" gap="tight">
                <s-clickable onClick={() => onToggle(thread.id)}>
                  <s-stack direction="block" gap="extra-tight">
                    <s-stack direction="inline" gap="tight" align-items="center">
                      <s-text type="strong">{thread.product_title}</s-text>
                      <s-badge tone={statusToneOf(thread.status)}>
                        {t(statusKey)}
                      </s-badge>
                    </s-stack>
                    <s-text tone="subdued">
                      {snippetOf(thread)}
                    </s-text>
                  </s-stack>
                </s-clickable>

                {isExpanded && (
                  <s-stack direction="block" gap="base">
                    <s-divider />
                    {thread.messages.map((m) => (
                      <s-box
                        key={m.id}
                        padding="base"
                        border-radius="base"
                        background={m.author === "customer" ? "subdued" : "info-subdued"}
                      >
                        <s-stack direction="block" gap="extra-tight">
                          <s-text type="strong">
                            {m.author === "customer" ? t("youLabel") : t("storeLabel")}
                          </s-text>
                          <s-paragraph>{m.text}</s-paragraph>
                        </s-stack>
                      </s-box>
                    ))}

                    {thread.status !== "promoted" && (
                      <s-stack direction="block" gap="tight">
                        <s-text-area
                          label={t("sendReply")}
                          value={replyText}
                          onInput={(e) => setReplyText(e.target.value)}
                          placeholder={t("replyPlaceholder")}
                          rows={3}
                          maxLength={2000}
                        />
                        {sendError ? (
                          <s-banner tone="critical">{sendError}</s-banner>
                        ) : null}
                        <s-button
                          variant="primary"
                          onClick={onSendReply}
                          disabled={!replyText.trim() || sending}
                        >
                          {sending ? t("sending") : t("sendReply")}
                        </s-button>
                      </s-stack>
                    )}
                  </s-stack>
                )}
              </s-stack>
            </s-box>
          );
        })}
      </s-stack>
    </s-section>
  );
}

function statusToneOf(status) {
  if (status === "awaiting_merchant") return "attention";
  if (status === "awaiting_customer") return "info";
  if (status === "promoted") return "success";
  return "neutral";
}

function snippetOf(thread) {
  const last = thread.messages?.[thread.messages.length - 1];
  if (!last) return "";
  const text = String(last.text ?? "");
  return text.length > 140 ? `${text.slice(0, 139)}…` : text;
}
