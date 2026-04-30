import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useBlocker,
  useFetcher,
  useLoaderData,
  useNavigate,
  useNavigation,
} from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { OWNER_TYPES, getOwnerType } from "../blocks/faq/owner-types";
import {
  bulkWriteFaq,
  readFaq,
  searchOwners,
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
    return { intent: "search", ownerType, q, results };
  }

  if (intent === "save") {
    const changesRaw = String(formData.get("changes") ?? "[]");
    let changes;
    try {
      changes = JSON.parse(changesRaw);
    } catch {
      return { intent: "save", ok: false, error: "Invalid changes payload." };
    }
    const cleaned = changes
      .map((c) => ({
        ownerType: String(c.ownerType ?? ""),
        ownerId: String(c.ownerId ?? ""),
        items: Array.isArray(c.items)
          ? c.items
              .map((it) => ({
                question: String(it.question ?? "").trim(),
                answer: String(it.answer ?? "").trim(),
              }))
              .filter((it) => it.question || it.answer)
          : [],
      }))
      .filter((c) => c.ownerId);

    if (!cleaned.length) {
      return { intent: "save", ok: false, error: "No changes to save." };
    }

    const result = await bulkWriteFaq(admin, cleaned);
    if (result.userErrors?.length) {
      return {
        intent: "save",
        ok: false,
        error: result.userErrors.map((e) => e.message).join(", "),
      };
    }
    return {
      intent: "save",
      ok: true,
      saved: cleaned.map(({ ownerId, items }) => ({ ownerId, items })),
    };
  }

  return { intent: "unknown", ok: false };
};

const OWNER_TYPE_OPTIONS = Object.values(OWNER_TYPES).map((d) => ({
  value: d.id,
  label: d.label,
}));

const SEARCH_DEBOUNCE_MS = 300;

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

export default function FaqEditor() {
  const data = useLoaderData();
  const saveFetcher = useFetcher();
  const searchFetcher = useFetcher();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  /**
   * pending: Map<ownerId, { ownerType, ownerLabel, originalItems, items }>
   * Holds every resource the user has opened, plus their in-flight edits.
   * Survives navigations within this route (component stays mounted).
   */
  const [pending, setPending] = useState({});
  const [searchQuery, setSearchQuery] = useState("");
  const searchDebounceRef = useRef(null);
  const lastIssuedSearchRef = useRef({ ownerType: null, q: null });

  // Initialize / refresh the active resource in `pending` when loader data lands.
  // Don't overwrite items the user has already edited locally.
  // Always ensure at least one row so the editor has something to render.
  useEffect(() => {
    if (!data.ownerType || !data.ownerId) return;
    setPending((prev) => {
      const existing = prev[data.ownerId];
      if (existing) return prev;
      const loaded = cloneItems(data.items);
      const items = loaded.length > 0 ? loaded : [emptyItem()];
      return {
        ...prev,
        [data.ownerId]: {
          ownerType: data.ownerType,
          ownerLabel: data.ownerLabel,
          originalItems: items.map((it) => ({ ...it })),
          items,
        },
      };
    });
  }, [data.ownerType, data.ownerId, data.ownerLabel, data.items]);

  const ownerDef = getOwnerType(data.ownerType);
  const activeOwnerId = data.ownerId || "";
  const activeResource = activeOwnerId ? pending[activeOwnerId] : null;
  const items = activeResource?.items ?? [];

  // Debounced search — runs whenever owner type or query changes.
  useEffect(() => {
    if (!ownerDef) return;
    if (ownerDef.id === "SHOP") return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      const issued = { ownerType: ownerDef.id, q: searchQuery };
      lastIssuedSearchRef.current = issued;
      const formData = new FormData();
      formData.set("intent", "search");
      formData.set("ownerType", ownerDef.id);
      formData.set("q", searchQuery);
      searchFetcher.submit(formData, { method: "POST" });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerDef?.id, searchQuery]);

  // Reset search when scope changes.
  useEffect(() => {
    setSearchQuery("");
  }, [ownerDef?.id]);

  // Toast on save outcomes.
  useEffect(() => {
    if (!saveFetcher.data || saveFetcher.data.intent !== "save") return;
    if (saveFetcher.data.ok) {
      const count = saveFetcher.data.saved?.length ?? 0;
      shopify.toast.show(
        count === 1 ? "FAQs saved" : `Saved ${count} resources`,
      );
      // Snap originalItems = current items for each saved entry, preserving keys.
      setPending((prev) => {
        const next = { ...prev };
        saveFetcher.data.saved.forEach(({ ownerId }) => {
          if (next[ownerId]) {
            next[ownerId] = {
              ...next[ownerId],
              originalItems: next[ownerId].items.map((it) => ({ ...it })),
            };
          }
        });
        return next;
      });
    } else {
      shopify.toast.show(saveFetcher.data.error ?? "Save failed", {
        isError: true,
      });
    }
  }, [saveFetcher.data, shopify]);

  // Compute dirty changes across all pending resources.
  const dirtyChanges = useMemo(() => {
    return Object.entries(pending)
      .filter(
        ([, r]) => itemsKey(r.items) !== itemsKey(r.originalItems),
      )
      .map(([ownerId, r]) => ({
        ownerId,
        ownerType: r.ownerType,
        ownerLabel: r.ownerLabel,
        items: r.items,
      }));
  }, [pending]);
  const isDirty = dirtyChanges.length > 0;

  const isSaving =
    saveFetcher.state !== "idle" &&
    saveFetcher.formData?.get("intent") === "save";
  const isSearching =
    searchFetcher.state !== "idle" &&
    searchFetcher.formData?.get("intent") === "search";

  // True while React Router runs the route loader (e.g. switching resources).
  const isNavigating = navigation.state === "loading";
  // The resource we're navigating to (used to flag the matching list row).
  const navigatingToOwnerId = isNavigating
    ? new URLSearchParams(navigation.location?.search ?? "").get("ownerId")
    : null;
  // While navigating, the new ownerId may not yet exist in `pending`.
  const isLoadingActiveResource =
    isNavigating || (Boolean(data.ownerId) && !activeResource);

  // Save bar handlers
  const submitSave = useCallback(() => {
    if (!dirtyChanges.length) return;
    const formData = new FormData();
    formData.set("intent", "save");
    formData.set(
      "changes",
      JSON.stringify(
        dirtyChanges.map(({ ownerType, ownerId, items: dirtyItems }) => ({
          ownerType,
          ownerId,
          items: dirtyItems,
        })),
      ),
    );
    saveFetcher.submit(formData, { method: "POST" });
  }, [dirtyChanges, saveFetcher]);

  const discardChanges = useCallback(() => {
    setPending((prev) => {
      const next = {};
      Object.entries(prev).forEach(([id, r]) => {
        next[id] = { ...r, items: cloneItems(r.originalItems) };
      });
      return next;
    });
  }, []);

  // Navigation guard: warn before leaving the editor with unsaved changes.
  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) =>
        isDirty && currentLocation.pathname !== nextLocation.pathname,
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

  // Resource type change → URL update, clears active ownerId.
  const handleOwnerTypeChange = (event) => {
    const next = event?.target?.value ?? event;
    if (!next || next === data.ownerType) return;
    if (next === "SHOP") {
      navigate(`/app/blocks/faq?ownerType=SHOP`);
    } else {
      navigate(`/app/blocks/faq?ownerType=${next}`);
    }
  };

  const switchToOwner = (ownerType, ownerId) => {
    if (ownerId === activeOwnerId) return;
    navigate(
      `/app/blocks/faq?ownerType=${ownerType}&ownerId=${encodeURIComponent(ownerId)}`,
    );
  };

  // Search results — only consider results matching the current scope.
  const searchResults = useMemo(() => {
    if (!ownerDef) return [];
    if (
      searchFetcher.data?.intent !== "search" ||
      searchFetcher.data?.ownerType !== ownerDef.id
    ) {
      return [];
    }
    return searchFetcher.data.results ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchFetcher.data, ownerDef?.id]);

  // Item edit helpers — write to pending[activeOwnerId].items
  const updateItems = (updater) => {
    setPending((prev) => {
      if (!activeOwnerId || !prev[activeOwnerId]) return prev;
      const current = prev[activeOwnerId];
      const nextItems =
        typeof updater === "function" ? updater(current.items) : updater;
      return {
        ...prev,
        [activeOwnerId]: { ...current, items: nextItems },
      };
    });
  };

  const updateItem = (idx, field, value) =>
    updateItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)),
    );
  const addItem = () => updateItems((prev) => [...prev, emptyItem()]);
  const removeItem = (idx) =>
    updateItems((prev) =>
      prev.length === 1 ? [emptyItem()] : prev.filter((_, i) => i !== idx),
    );
  const moveItem = (idx, dir) =>
    updateItems((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });

  const visibleItems = items;
  const canEdit = Boolean(ownerDef && activeResource);
  const showSearchList = ownerDef && ownerDef.id !== "SHOP";

  return (
    <s-page heading="FAQs" backAction={{ content: "Back", url: "/app" }}>
      <SaveBar id="faq-editor-save-bar" open={isDirty}>
        <button
          variant="primary"
          onClick={submitSave}
          {...(isSaving ? { loading: "" } : {})}
        >
          {dirtyChanges.length > 1
            ? `Save (${dirtyChanges.length})`
            : "Save"}
        </button>
        <button onClick={discardChanges} disabled={isSaving}>
          Discard
        </button>
      </SaveBar>

      <s-banner tone="info" dismissible heading="How FAQs work">
        Pick a resource on the right, add question/answer pairs, then save.
        FAQs are stored as a JSON metafield in <code>app:faq</code>. Display
        them on the storefront by adding the <strong>FAQ Block</strong> theme
        app extension to a section in your theme editor. You can edit FAQs
        for multiple resources before saving — your unsaved changes appear in
        the sidebar.
      </s-banner>

      <s-section
        heading={
          activeResource
            ? activeResource.ownerLabel ?? "FAQs"
            : ownerDef
              ? `Pick a ${ownerDef.label.toLowerCase()}`
              : "FAQs"
        }
      >
        {!ownerDef ? (
          <s-paragraph>
            Choose a resource type from the sidebar to begin.
          </s-paragraph>
        ) : isLoadingActiveResource ? (
          <s-stack direction="inline" alignItems="center" gap="base">
            <s-spinner accessibilityLabel="Loading FAQs" size="large" />
            <s-text>Loading FAQs…</s-text>
          </s-stack>
        ) : !canEdit ? (
          <s-paragraph>
            {ownerDef.id === "SHOP"
              ? "Loading shop FAQs…"
              : `Search for a ${ownerDef.label.toLowerCase()} in the sidebar to start editing.`}
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {visibleItems.map((item, idx) => (
              <s-box
                key={item._key}
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
                      disabled={idx === visibleItems.length - 1}
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
        )}
      </s-section>

      <s-section slot="aside" heading="Resource">
        <s-stack direction="block" gap="base">
          <s-select
            label="Resource type"
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

          {ownerDef?.id === "SHOP" && (
            <s-paragraph>
              Editing <strong>{data.ownerLabel ?? "current shop"}</strong>.
            </s-paragraph>
          )}

          {showSearchList && (
            <>
              <s-search-field
                label={`Search ${ownerDef.label.toLowerCase()}s`}
                placeholder="Type to filter..."
                value={searchQuery}
                onInput={(e) => setSearchQuery(e?.target?.value ?? "")}
              />
              {isSearching && searchResults.length > 0 && (
                <s-stack
                  direction="inline"
                  alignItems="center"
                  gap="small"
                >
                  <s-spinner accessibilityLabel="Updating results" />
                  <s-text>Updating…</s-text>
                </s-stack>
              )}
              <div
                style={{
                  maxHeight: "480px",
                  overflowY: "auto",
                  border: "1px solid rgba(0, 0, 0, 0.12)",
                  borderRadius: "8px",
                }}
              >
                {isSearching && searchResults.length === 0 ? (
                  <s-box padding="base">
                    <s-stack
                      direction="inline"
                      alignItems="center"
                      gap="small"
                    >
                      <s-spinner accessibilityLabel="Searching" />
                      <s-text>Searching…</s-text>
                    </s-stack>
                  </s-box>
                ) : searchResults.length === 0 ? (
                  <s-box padding="base">
                    <s-paragraph>
                      {searchQuery
                        ? "No matches."
                        : `Start typing to search ${ownerDef.label.toLowerCase()}s.`}
                    </s-paragraph>
                  </s-box>
                ) : (
                  searchResults.map((r) => (
                    <s-clickable
                      key={r.id}
                      onClick={() => switchToOwner(ownerDef.id, r.id)}
                      padding="base"
                      background={
                        r.id === activeOwnerId ? "subdued" : undefined
                      }
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          flexWrap: "nowrap",
                        }}
                      >
                        {r.imageUrl ? (
                          <div style={{ flexShrink: 0 }}>
                            <s-thumbnail
                              src={r.imageUrl}
                              alt={r.imageAlt ?? r.label}
                              size="small"
                            />
                          </div>
                        ) : null}
                        <div
                          style={{
                            flex: "1 1 auto",
                            minWidth: 0,
                            overflowWrap: "anywhere",
                          }}
                        >
                          <s-text>{r.label}</s-text>
                        </div>
                        {r.id === navigatingToOwnerId ? (
                          <div style={{ flexShrink: 0 }}>
                            <s-spinner accessibilityLabel="Loading" />
                          </div>
                        ) : null}
                      </div>
                    </s-clickable>
                  ))
                )}
              </div>
            </>
          )}
        </s-stack>
      </s-section>

      {dirtyChanges.length > 0 && (
        <s-section
          slot="aside"
          heading={`Unsaved changes (${dirtyChanges.length})`}
        >
          <s-box borderWidth="base" borderRadius="base" overflow="hidden">
            {dirtyChanges.map((c) => (
              <s-clickable
                key={c.ownerId}
                onClick={() => switchToOwner(c.ownerType, c.ownerId)}
                padding="base"
                background={
                  c.ownerId === activeOwnerId ? "subdued" : undefined
                }
              >
                <s-stack direction="inline" gap="tight">
                  <s-badge>
                    {getOwnerType(c.ownerType)?.label ?? c.ownerType}
                  </s-badge>
                  <s-text>{c.ownerLabel ?? c.ownerId}</s-text>
                </s-stack>
              </s-clickable>
            ))}
          </s-box>
        </s-section>
      )}
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
