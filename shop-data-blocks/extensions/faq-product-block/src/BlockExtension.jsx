import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

let itemKeyCounter = 0;
const newItemKey = () =>
  `item-${Date.now().toString(36)}-${++itemKeyCounter}`;
const emptyItem = () => ({ _key: newItemKey(), question: "", answer: "" });
const cloneItems = (items) =>
  items?.length
    ? items.map((it) => ({
        _key: it._key ?? newItemKey(),
        question: it.question ?? "",
        answer: it.answer ?? "",
      }))
    : [];
const itemsKey = (items) =>
  JSON.stringify(
    (items ?? []).map((it) => ({
      question: it.question ?? "",
      answer: it.answer ?? "",
    })),
  );
const truncate = (str, max) =>
  str.length > max ? `${str.slice(0, max)}…` : str;

async function readFaq(productId) {
  const res = await fetch("shopify:admin/api/graphql.json", {
    method: "POST",
    body: JSON.stringify({
      query: `query Faq($id: ID!) {
        product(id: $id) {
          metafield(namespace: "$app", key: "faq") { jsonValue }
        }
      }`,
      variables: { id: productId },
    }),
  });
  const json = await res.json();
  return json.data?.product?.metafield?.jsonValue?.items ?? [];
}

async function writeFaq(productId, items) {
  const cleaned = items
    .map((it) => ({
      question: String(it.question ?? "").trim(),
      answer: String(it.answer ?? "").trim(),
    }))
    .filter((it) => it.question || it.answer);
  const res = await fetch("shopify:admin/api/graphql.json", {
    method: "POST",
    body: JSON.stringify({
      query: `mutation SetFaq($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }`,
      variables: {
        metafields: [
          {
            ownerId: productId,
            namespace: "$app",
            key: "faq",
            type: "json",
            value: JSON.stringify({ items: cleaned }),
          },
        ],
      },
    }),
  });
  return res.json();
}

function Extension() {
  const { data, i18n } = shopify;
  const t = (key, params) => i18n.translate(key, params);
  const productId = data?.selected?.[0]?.id ?? "";

  const [items, setItems] = useState([]);
  const [pristineKey, setPristineKey] = useState(itemsKey([]));
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const fetched = await readFaq(productId);
        if (cancelled) return;
        const cloned = cloneItems(fetched);
        const initial = cloned.length > 0 ? cloned : [emptyItem()];
        setItems(initial);
        setPristineKey(itemsKey(initial));
        setActiveIndex(0);
      } catch (err) {
        if (!cancelled) setError(t("loadError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const isDirty = useMemo(
    () => itemsKey(items) !== pristineKey,
    [items, pristineKey],
  );

  const safeActiveIndex = Math.min(
    Math.max(activeIndex, 0),
    Math.max(items.length - 1, 0),
  );
  const activeItem = items[safeActiveIndex];

  const updateItem = (idx, field, value) =>
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)),
    );

  const addItem = () => {
    setItems((prev) => [...prev, emptyItem()]);
    setActiveIndex(items.length);
  };

  const removeItem = (idx) => {
    if (items.length === 1) {
      setItems([emptyItem()]);
      setActiveIndex(0);
      return;
    }
    setItems((prev) => prev.filter((_, i) => i !== idx));
    if (idx < activeIndex) {
      setActiveIndex((prev) => prev - 1);
    } else if (idx === activeIndex) {
      setActiveIndex((prev) => Math.max(0, Math.min(prev, items.length - 2)));
    }
  };

  const moveItem = (idx, dir) => {
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    setItems((prev) => {
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
    if (activeIndex === idx) setActiveIndex(target);
    else if (activeIndex === target) setActiveIndex(idx);
  };

  const submitSave = async () => {
    if (!productId) return;
    setSaving(true);
    setError("");
    try {
      const result = await writeFaq(productId, items);
      const errs = result?.data?.metafieldsSet?.userErrors ?? [];
      if (errs.length) {
        setError(errs.map((e) => e.message).join(", "));
      } else {
        setPristineKey(itemsKey(items));
      }
    } catch (err) {
      setError(t("saveError"));
    } finally {
      setSaving(false);
    }
  };

  const discardChanges = async () => {
    if (!productId) return;
    setLoading(true);
    setError("");
    try {
      const fetched = await readFaq(productId);
      const cloned = cloneItems(fetched);
      const initial = cloned.length > 0 ? cloned : [emptyItem()];
      setItems(initial);
      setPristineKey(itemsKey(initial));
      setActiveIndex(0);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <s-admin-block heading={t("name")}>
        <s-stack direction="inline" align-items="center" gap="base">
          <s-spinner accessibility-label={t("loadingAccessibility")} />
          <s-text>{t("loading")}</s-text>
        </s-stack>
      </s-admin-block>
    );
  }

  return (
    <s-admin-block heading={t("name")}>
      <s-stack direction="block" gap="base">
        {error ? <s-banner tone="critical">{error}</s-banner> : null}

        <s-stack
          direction="inline"
          gap="base"
          align-items="flex-start"
          inline-size="100%"
        >
          <s-box inline-size="80%" min-inline-size="350px">
            {activeItem ? (
              <s-stack direction="block" gap="base">
                <s-text-field
                  label={t("question", { n: safeActiveIndex + 1 })}
                  value={activeItem.question}
                  onInput={(e) =>
                    updateItem(
                      safeActiveIndex,
                      "question",
                      e?.target?.value ?? "",
                    )
                  }
                />
                <s-text-area
                  label={t("answer")}
                  value={activeItem.answer}
                  rows={4}
                  onInput={(e) =>
                    updateItem(
                      safeActiveIndex,
                      "answer",
                      e?.target?.value ?? "",
                    )
                  }
                />
                <s-stack
                  direction="inline"
                  gap="small-100"
                  justify-content="space-between"
                  align-items="center"
                >
                  <s-stack direction="inline" gap="small-100">
                    <s-button
                      variant="tertiary"
                      icon="arrow-up"
                      accessibility-label={t("moveUp")}
                      interest-for="faq-tip-move-up"
                      disabled={safeActiveIndex === 0}
                      onClick={() => moveItem(safeActiveIndex, -1)}
                    />
                    <s-tooltip id="faq-tip-move-up">{t("moveUp")}</s-tooltip>
                    <s-button
                      variant="tertiary"
                      icon="arrow-down"
                      accessibility-label={t("moveDown")}
                      interest-for="faq-tip-move-down"
                      disabled={safeActiveIndex === items.length - 1}
                      onClick={() => moveItem(safeActiveIndex, 1)}
                    />
                    <s-tooltip id="faq-tip-move-down">{t("moveDown")}</s-tooltip>
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      icon="delete"
                      accessibility-label={t("remove")}
                      interest-for="faq-tip-remove"
                      onClick={() => removeItem(safeActiveIndex)}
                    />
                    <s-tooltip id="faq-tip-remove">{t("remove")}</s-tooltip>
                  </s-stack>
                  <s-stack direction="inline" gap="small-100">
                    <s-button
                      variant="tertiary"
                      disabled={!isDirty || saving}
                      onClick={discardChanges}
                    >
                      {t("discard")}
                    </s-button>
                    <s-button
                      variant="primary"
                      disabled={!isDirty || saving}
                      loading={saving}
                      onClick={submitSave}
                    >
                      {t("save")}
                    </s-button>
                  </s-stack>
                </s-stack>
              </s-stack>
            ) : (
              <s-paragraph>{t("emptyState")}</s-paragraph>
            )}
          </s-box>

          <s-box inline-size="20%" min-inline-size="0">
            <s-stack direction="block" gap="small-200">
              {items.map((item, idx) => (
                <s-clickable
                  key={item._key}
                  padding-block="small-100"
                  padding-inline="small-100"
                  border-radius="base"
                  background={
                    idx === safeActiveIndex ? "subdued" : undefined
                  }
                  onClick={() => setActiveIndex(idx)}
                >
                  <s-text>
                    {`${idx + 1}. ${truncate(item.question || t("untitled"), 30)}`}
                  </s-text>
                </s-clickable>
              ))}
              <s-button variant="tertiary" onClick={addItem}>
                {t("addQuestion")}
              </s-button>
            </s-stack>
          </s-box>
        </s-stack>
      </s-stack>
    </s-admin-block>
  );
}
