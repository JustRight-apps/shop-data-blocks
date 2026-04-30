import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useBlocker,
  useFetcher,
  useLoaderData,
  useNavigate,
} from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { OWNER_TYPES, getOwnerType } from "../blocks/faq/owner-types";
import {
  readFaq,
  searchOwners,
  writeFaq,
} from "../blocks/faq/metafield.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const ownerType = url.searchParams.get("ownerType") ?? "";
  const ownerId = url.searchParams.get("ownerId") ?? "";

  const definition = getOwnerType(ownerType);
  if (!definition) {
    return { ownerType: "", ownerId: "", ownerLabel: null, items: [] };
  }

  if (ownerType === "SHOP") {
    const data = await readFaq(admin, "SHOP", null);
    return { ownerType, ...data };
  }

  if (!ownerId) {
    return { ownerType, ownerId: "", ownerLabel: null, items: [] };
  }

  const data = await readFaq(admin, ownerType, ownerId);
  return { ownerType, ...data };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "search") {
    const ownerType = String(formData.get("ownerType") ?? "");
    const q = String(formData.get("q") ?? "");
    const results = await searchOwners(admin, ownerType, q);
    return { intent: "search", results };
  }

  if (intent === "save") {
    const ownerType = String(formData.get("ownerType") ?? "");
    const ownerId = String(formData.get("ownerId") ?? "");
    const itemsRaw = String(formData.get("items") ?? "[]");
    if (!ownerType || !ownerId) {
      return { intent: "save", ok: false, error: "Pick a resource first." };
    }
    let items;
    try {
      items = JSON.parse(itemsRaw);
    } catch {
      return { intent: "save", ok: false, error: "Invalid items payload." };
    }
    items = items
      .map((it) => ({
        question: String(it.question ?? "").trim(),
        answer: String(it.answer ?? "").trim(),
      }))
      .filter((it) => it.question || it.answer);

    const result = await writeFaq(admin, ownerId, items);
    if (result.userErrors?.length) {
      return {
        intent: "save",
        ok: false,
        error: result.userErrors.map((e) => e.message).join(", "),
      };
    }
    return { intent: "save", ok: true, items };
  }

  return { intent: "unknown", ok: false };
};

const OWNER_TYPE_OPTIONS = Object.values(OWNER_TYPES).map((d) => ({
  value: d.id,
  label: d.label,
}));

const SAVE_BAR_ID = "faq-editor-save-bar";

const emptyItem = () => ({ question: "", answer: "" });
const initialItems = (loaded) =>
  loaded?.length ? loaded.map((it) => ({ ...it })) : [emptyItem()];
const itemsKey = (items) =>
  JSON.stringify(
    items.map((it) => ({
      question: it.question ?? "",
      answer: it.answer ?? "",
    })),
  );

export default function FaqEditor() {
  const data = useLoaderData();
  const saveFetcher = useFetcher();
  const searchFetcher = useFetcher();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  const [items, setItems] = useState(() => initialItems(data.items));
  const [pristineKey, setPristineKey] = useState(() =>
    itemsKey(initialItems(data.items)),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const pendingSaveRef = useRef(false);

  // When the loaded resource changes, reset both current and pristine items.
  useEffect(() => {
    const next = initialItems(data.items);
    setItems(next);
    setPristineKey(itemsKey(next));
  }, [data.ownerType, data.ownerId, data.items]);

  const isDirty = useMemo(
    () => itemsKey(items) !== pristineKey,
    [items, pristineKey],
  );

  // After a successful save, snap pristine to what the server returned.
  useEffect(() => {
    if (!saveFetcher.data || saveFetcher.data.intent !== "save") return;
    if (saveFetcher.data.ok) {
      const saved = initialItems(saveFetcher.data.items);
      setItems(saved);
      setPristineKey(itemsKey(saved));
      shopify.toast.show("FAQs saved");
    } else {
      shopify.toast.show(saveFetcher.data.error ?? "Save failed", {
        isError: true,
      });
    }
    pendingSaveRef.current = false;
  }, [saveFetcher.data, shopify]);

  const ownerDef = getOwnerType(data.ownerType);
  const isSaving =
    saveFetcher.state !== "idle" &&
    saveFetcher.formData?.get("intent") === "save";
  const isReady = Boolean(ownerDef && data.ownerId);

  const submitSave = useCallback(() => {
    if (!ownerDef || !data.ownerId) return;
    pendingSaveRef.current = true;
    const formData = new FormData();
    formData.set("intent", "save");
    formData.set("ownerType", ownerDef.id);
    formData.set("ownerId", data.ownerId);
    formData.set("items", JSON.stringify(items));
    saveFetcher.submit(formData, { method: "POST" });
  }, [ownerDef, data.ownerId, items, saveFetcher]);

  const discardChanges = useCallback(() => {
    setItems(initialItems(data.items));
  }, [data.items]);

  // Block React Router navigations when there are unsaved changes.
  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) =>
        isDirty &&
        (currentLocation.pathname !== nextLocation.pathname ||
          currentLocation.search !== nextLocation.search),
      [isDirty],
    ),
  );

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    let cancelled = false;
    shopify.saveBar
      .leaveConfirmation()
      .then(() => {
        if (!cancelled) blocker.proceed();
      })
      .catch(() => {
        if (!cancelled) blocker.reset();
      });
    return () => {
      cancelled = true;
    };
  }, [blocker, shopify]);

  const handleOwnerTypeChange = (event) => {
    const next = event?.target?.value ?? event;
    if (!next) return;
    if (next === data.ownerType) return;
    if (next === "SHOP") {
      navigate(`/app/blocks/faq?ownerType=SHOP`);
    } else {
      navigate(`/app/blocks/faq?ownerType=${next}`);
    }
  };

  const openResourcePicker = async () => {
    if (!ownerDef?.pickerType) return;
    const selected = await shopify.resourcePicker({
      type: ownerDef.pickerType,
      multiple: false,
    });
    const node = selected?.[0];
    if (node?.id && node.id !== data.ownerId) {
      navigate(
        `/app/blocks/faq?ownerType=${ownerDef.id}&ownerId=${encodeURIComponent(node.id)}`,
      );
    }
  };

  const runSearch = (q) => {
    setSearchQuery(q);
    if (!ownerDef) return;
    const formData = new FormData();
    formData.set("intent", "search");
    formData.set("ownerType", ownerDef.id);
    formData.set("q", q);
    searchFetcher.submit(formData, { method: "POST" });
  };

  const pickSearchResult = (result) => {
    if (result.id === data.ownerId) return;
    navigate(
      `/app/blocks/faq?ownerType=${ownerDef.id}&ownerId=${encodeURIComponent(result.id)}`,
    );
    setSearchQuery("");
  };

  const updateItem = (idx, field, value) => {
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)),
    );
  };
  const addItem = () => setItems((prev) => [...prev, emptyItem()]);
  const removeItem = (idx) =>
    setItems((prev) =>
      prev.length === 1 ? [emptyItem()] : prev.filter((_, i) => i !== idx),
    );
  const moveItem = (idx, dir) =>
    setItems((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });

  const searchResults = useMemo(() => {
    if (searchFetcher.data?.intent !== "search") return [];
    return searchFetcher.data.results ?? [];
  }, [searchFetcher.data]);

  const isSearchableType =
    ownerDef && !ownerDef.pickerType && ownerDef.id !== "SHOP";

  return (
    <s-page heading="FAQs" backAction={{ content: "Back", url: "/app" }}>
      <SaveBar id={SAVE_BAR_ID} open={isDirty && isReady}>
        <button
          variant="primary"
          onClick={submitSave}
          {...(isSaving ? { loading: "" } : {})}
        >
          Save
        </button>
        <button onClick={discardChanges} disabled={isSaving}>
          Discard
        </button>
      </SaveBar>

      <s-section heading="Resource">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Choose what these FAQs attach to. Data is saved as a JSON metafield
            on the selected resource.
          </s-paragraph>

          <s-select
            label="Resource type"
            name="ownerType"
            value={data.ownerType || ""}
            onChange={handleOwnerTypeChange}
          >
            <s-option value="">Select a type</s-option>
            {OWNER_TYPE_OPTIONS.map((opt) => (
              <s-option key={opt.value} value={opt.value}>
                {opt.label}
              </s-option>
            ))}
          </s-select>

          {ownerDef?.pickerType && (
            <s-stack direction="inline" gap="base">
              <s-button onClick={openResourcePicker}>
                {data.ownerLabel
                  ? `Selected: ${data.ownerLabel}`
                  : `Pick a ${ownerDef.label.toLowerCase()}`}
              </s-button>
              {data.ownerLabel && (
                <s-button onClick={openResourcePicker} variant="tertiary">
                  Change
                </s-button>
              )}
            </s-stack>
          )}

          {ownerDef?.id === "SHOP" && (
            <s-paragraph>
              Selected: <strong>{data.ownerLabel ?? "Current shop"}</strong>
            </s-paragraph>
          )}

          {isSearchableType && (
            <s-stack direction="block" gap="base">
              <s-text-field
                label={`Search ${ownerDef.label.toLowerCase()}s`}
                value={searchQuery}
                onInput={(e) => runSearch(e?.target?.value ?? "")}
              />
              {data.ownerLabel && (
                <s-paragraph>
                  Selected: <strong>{data.ownerLabel}</strong>
                </s-paragraph>
              )}
              {searchResults.length > 0 && (
                <s-box
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <s-stack direction="block" gap="tight">
                    {searchResults.map((r) => (
                      <s-button
                        key={r.id}
                        onClick={() => pickSearchResult(r)}
                        variant="tertiary"
                      >
                        {r.label}
                      </s-button>
                    ))}
                  </s-stack>
                </s-box>
              )}
            </s-stack>
          )}
        </s-stack>
      </s-section>

      {isReady && (
        <s-section heading="Questions">
          <s-stack direction="block" gap="base">
            {items.map((item, idx) => (
              <s-box
                key={idx}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="block" gap="base">
                  <s-text-field
                    label={`Question ${idx + 1}`}
                    value={item.question}
                    onInput={(e) =>
                      updateItem(idx, "question", e?.target?.value ?? "")
                    }
                  />
                  <s-text-area
                    label="Answer"
                    value={item.answer}
                    rows={3}
                    onInput={(e) =>
                      updateItem(idx, "answer", e?.target?.value ?? "")
                    }
                  />
                  <s-stack direction="inline" gap="tight">
                    <s-button
                      variant="tertiary"
                      disabled={idx === 0}
                      onClick={() => moveItem(idx, -1)}
                    >
                      Move up
                    </s-button>
                    <s-button
                      variant="tertiary"
                      disabled={idx === items.length - 1}
                      onClick={() => moveItem(idx, 1)}
                    >
                      Move down
                    </s-button>
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      onClick={() => removeItem(idx)}
                    >
                      Remove
                    </s-button>
                  </s-stack>
                </s-stack>
              </s-box>
            ))}
            <s-stack direction="inline" gap="base">
              <s-button onClick={addItem}>Add question</s-button>
            </s-stack>
          </s-stack>
        </s-section>
      )}

      <s-section slot="aside" heading="How it works">
        <s-paragraph>
          FAQs are stored as a JSON metafield in the <code>app:faq</code>{" "}
          namespace on the selected resource.
        </s-paragraph>
        <s-paragraph>
          To display them on the storefront, add the <strong>FAQ Block</strong>{" "}
          theme app extension to a section in your theme editor.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
