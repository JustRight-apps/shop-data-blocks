# Shop Data Blocks — Architecture & Patterns

This template ships a multi-surface "block" pattern: each block is a feature
that lets a merchant attach data to a Shopify resource, edit it in the embedded
admin app, and render it on the storefront via a theme app extension. The
**FAQ block** is the reference implementation — its full surface area is
documented below so a new block can copy the patterns directly.

> Read this before adding a new block or extending FAQs. Many of the choices
> below were forced by Shopify-platform constraints we discovered the hard way.

---

## Anatomy of a block (4 surfaces)

A block is composed of up to four surfaces. The FAQ block uses all four.

| # | Surface | Where | Purpose |
|---|---|---|---|
| 1 | **Dashboard card** | `/app` ([app/routes/app._index.jsx](app/routes/app._index.jsx)) | Lists blocks; opens the editor at a chosen scope. |
| 2 | **In-app editor** | `/app/blocks/<id>` ([app/routes/app.blocks.faq.jsx](app/routes/app.blocks.faq.jsx)) | Full-fidelity editor with all 7 owner types, multi-resource pending state, batched save. |
| 3 | **Admin block extension** *(optional)* | Product detail page ([extensions/faq-product-block/](extensions/faq-product-block/)) | Inline editor card embedded directly on a Shopify resource page. |
| 4 | **Theme app extension** | Storefront ([extensions/faq-block/](extensions/faq-block/)) | Renders the block's data on the storefront, with structured-data SEO. |
| + | **Admin link extensions** *(optional)* | Product details / index ([extensions/faq-product-link/](extensions/faq-product-link/), [extensions/faq-product-index-link/](extensions/faq-product-index-link/)) | One-click links from admin pages into the editor. Static URL only — no dynamic resource id substitution. |

A block is **registered** in [app/blocks/registry.js](app/blocks/registry.js):

```js
export const blocks = [
  {
    id: "faq",
    title: "FAQs",
    description: "...",
    editorPath: "/app/blocks/faq",
    scopes: [
      { value: "PRODUCT", label: "Product", icon: "product" },
      { value: "PRODUCTVARIANT", label: "Variant", icon: "variant" },
      // ... up to 7
    ],
  },
];
```

The dashboard renders a card per registry entry with a `<s-menu>` popover for
scope selection, so adding a new block is just an entry here.

---

## Data model

### Metafield namespace

All block data is written to **app-owned metafields** under the reserved
`$app` namespace. The TOML definition lives in
[shopify.app.toml](shopify.app.toml):

```toml
[product.metafields.app.faq]
name = "FAQ"
type = "json"
description = "..."
[product.metafields.app.faq.access]
admin = "merchant_read_write"
```

The TOML key segment is the resource type. The CLI accepts these:
`product`, `variant` (NOT `product_variant`), `collection`, `shop`, `market`,
`blog`, `article`. We declare definitions for all 7 in TOML — none need
runtime `metafieldDefinitionCreate` calls.

### Read/write conventions

| Context | Namespace |
|---|---|
| Admin GraphQL (`metafieldsSet`, queries) | `"$app"` literal — Shopify resolves to `app--<numeric-id>` |
| Liquid (theme extension) | `metafields["$app"]["<key>"]` bracket access — see *Gotchas* |
| Admin extension Liquid/GraphQL | `"$app"` token, same as the embedded app |

**Do not use `metafields.app.<key>` shorthand in Liquid.** It does not resolve
to the app-reserved namespace in many environments (see Gotcha #2).

### JSON shape

Each block's metafield is `type: "json"`. The FAQ value is:

```json
{ "items": [ { "question": "...", "answer": "..." } ] }
```

Wrap the array in an outer object so future additions (e.g. block-level
settings) can extend the schema without breaking parsers.

---

## Owner types

[app/blocks/faq/owner-types.js](app/blocks/faq/owner-types.js) is the single
source of truth for the 7 supported resource types. Each entry has:

```js
{
  id: "PRODUCT",                            // GraphQL MetafieldOwnerType enum
  label: "Product",                         // user-facing name
  metafieldOwnerType: "PRODUCT",
  gidPrefix: "gid://shopify/Product/",
  pickerType: "product",                    // App Bridge resourcePicker type, or null
}
```

**Note the GID quirks:**
- `gid://shopify/OnlineStoreBlog/...` (NOT `Blog`)
- `gid://shopify/OnlineStoreArticle/...` (NOT `Article`)
- `PRODUCTVARIANT` enum is one word (no underscore in MetafieldOwnerType)

**Important:** This file lives at `owner-types.js`, NOT `.server.js`. React
Router 7 forbids importing a `.server.js` module from a route that has both a
client component AND server code (loader/action). Constants like
`OWNER_TYPES` and `getOwnerType` are needed by the React component for
rendering, so they live in a client-safe module. Server-only code (GraphQL
queries) lives in [`metafield.server.js`](app/blocks/faq/metafield.server.js).

---

## Surface 1: Dashboard card

[app/routes/app._index.jsx](app/routes/app._index.jsx) reads the registry and
renders one `<s-section>` per block. The "Open editor" button opens an
`<s-menu>` popover listing all scopes, each item is a navigation link to
`?ownerType=<scope>`:

```jsx
<s-button variant="primary" commandFor={menuId}>Open editor</s-button>
<s-menu id={menuId} accessibilityLabel="Choose FAQs scope">
  {block.scopes.map((scope) => (
    <s-button key={scope.value} icon={scope.icon}
      href={`${block.editorPath}?ownerType=${scope.value}`}>
      {scope.label}
    </s-button>
  ))}
</s-menu>
```

**Layout note:** the `<s-menu>` must be a *direct sibling* of its trigger
`<s-button>`. CSS anchor positioning uses both `commandFor` and DOM proximity;
nesting the menu deeper in the section caused it to anchor to the wrong
bounding box.

---

## Surface 2: In-app editor

[app/routes/app.blocks.faq.jsx](app/routes/app.blocks.faq.jsx) — the main
editor. URL contract is `?ownerType=X&ownerId=<gid>`. The route does a lot in
one file; future blocks should mirror the same structure.

### Server module split

```
app/blocks/faq/
├── owner-types.js          # CLIENT-SAFE constants and enums
└── metafield.server.js     # SERVER-ONLY: readFaq, bulkWriteFaq, searchOwners
```

Importing `*.server.js` from a route is fine inside `loader`/`action` only.
Anything the React component touches must live in a non-`.server.js` module
or [app/shopify.server.js](app/shopify.server.js).

### Loader / action contract

```js
// loader: fetch the active resource based on URL params
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const ownerType = url.searchParams.get("ownerType") ?? "";
  const ownerId   = url.searchParams.get("ownerId") ?? "";
  // ... readFaq(admin, ownerType, ownerId)
};

// action: dispatches on `intent` form field
//   "search" -> searchOwners → list of {id, label, imageUrl?}
//   "save"   -> bulkWriteFaq → metafieldsSet (up to 25 metafields per call)
export const action = async ({ request }) => { /* ... */ };
```

### Multi-resource pending state

This is the most non-obvious pattern in the codebase. The editor allows
editing FAQs for multiple resources before saving — every resource the
merchant touches goes into a `pending` map and a single Save commits all
dirty entries at once.

```js
// Map<ownerId, { ownerType, ownerLabel, originalItems, items }>
const [pending, setPending] = useState({});

// Initialize a pending entry when the loader returns data,
// but DO NOT overwrite if the user has already edited it locally.
useEffect(() => {
  if (!data.ownerId) return;
  setPending((prev) => {
    if (prev[data.ownerId]) return prev;          // keep existing edits
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

const dirtyChanges = Object.entries(pending)
  .filter(([, r]) => itemsKey(r.items) !== itemsKey(r.originalItems))
  .map(([ownerId, r]) => ({ ownerId, ownerType: r.ownerType, items: r.items }));
```

A "dirty" entry is one whose serialized `items` differ from `originalItems`.
The sidebar's **Unsaved changes** section lists every dirty entry — clicking
one navigates to it (URL changes; pending state survives because the
component stays mounted across same-route nav).

### Save bar

The App Bridge `<SaveBar open={isDirty}>` from
`@shopify/app-bridge-react` wraps a `<button variant="primary">` and a
`<button>` (Discard). `useBlocker` from `react-router` intercepts navigation
when dirty and calls `shopify.saveBar.leaveConfirmation()` (a Promise that
resolves on confirm / rejects on cancel) so the user is asked before losing
edits.

### Stable item keys

```js
let itemKeyCounter = 0;
const newItemKey = () =>
  `item-${Date.now().toString(36)}-${++itemKeyCounter}`;
const emptyItem = () => ({ _key: newItemKey(), question: "", answer: "" });
```

Each item carries a generated `_key` field used for `<… key={item._key}>`.
**Why this matters:** Polaris web components hold internal input state. With
`key={idx}`, removing or reordering items reuses the same DOM node with new
props — but the web component does NOT re-sync its value, so the visible
input "lags" by one. With stable keys, React mounts/unmounts items
correctly. The `_key` is stripped at save time (the action only persists
`question`/`answer`).

### Debounced search

The right-panel search uses `useFetcher` (separate from the save fetcher) and
a 300ms debounce to fire `intent=search`. Each fetcher response is checked
against the **current** owner type before being rendered, so stale results
from a previous scope don't flash:

```js
const searchResults = useMemo(() => {
  if (searchFetcher.data?.intent !== "search") return [];
  if (searchFetcher.data?.ownerType !== ownerDef.id) return [];
  return searchFetcher.data.results ?? [];
}, [searchFetcher.data, ownerDef?.id]);
```

`searchOwners` returns `{ id, label, imageUrl?, imageAlt? }`. For products,
variants, collections, articles we fetch a thumbnail (`featuredMedia` /
`image`); blogs, markets and shop have no image and `imageUrl` is `null`.

Result rows are `<s-clickable>` rows in a native `<div style={{maxHeight:
"480px", overflowY: "auto"}}>` (Polaris `<s-box overflow="auto">` does not
exist — see Gotcha #5). Thumbnail + text use a flex `<div>` with
`flex-shrink: 0` on the thumbnail and `min-width: 0; overflow-wrap: anywhere`
on the text, so long titles wrap inside the row instead of pushing the
thumbnail off.

### Loading states

`useNavigation()` from `react-router` powers the per-row "loading" spinner:

```js
const navigation = useNavigation();
const isNavigating = navigation.state === "loading";
const navigatingToOwnerId = isNavigating
  ? new URLSearchParams(navigation.location?.search ?? "").get("ownerId")
  : null;

// In the result list — render a spinner on the row currently navigating to
{r.id === navigatingToOwnerId && <s-spinner accessibilityLabel="Loading" />}
```

The main editor area shows a `<s-spinner size="large">` whenever
`isNavigating || (data.ownerId && !activeResource)` so the merchant sees
feedback while a resource fetch is in flight.

---

## Surface 3: Admin block extension

[extensions/faq-product-block/](extensions/faq-product-block/) is a
`ui_extension` with target `admin.product-details.block.render`. It renders
**inline on the product detail page** as a card the merchant can add via
**Customize layout → Add section**.

### Master/detail layout

The block uses an inline `<s-stack>` with two `<s-box>` children acting as
80% / 20% columns:

```jsx
<s-stack direction="inline" gap="base" align-items="flex-start" inline-size="100%">
  <s-box inline-size="80%" min-inline-size="350px">{/* editor */}</s-box>
  <s-box inline-size="20%" min-inline-size="0">{/* question list */}</s-box>
</s-stack>
```

`min-inline-size="0"` on the right column is **mandatory** — flex children
default to `min-width: auto` and won't shrink below their content's natural
width, defeating the percentage `inline-size`. `min-inline-size="350px"` on
the left forces the editor to claim a usable minimum even at narrow block
widths.

`<s-grid>` was tried first and **renders columns stacked vertically** in
admin block contexts at typical widths. Use the inline `<s-stack>` with
widthed boxes instead.

### Active item state

Unlike the in-app editor (which edits all items at once), the admin block
shows one item at a time on the left and a clickable list on the right:

```js
const [activeIndex, setActiveIndex] = useState(0);
const safeActiveIndex = Math.min(
  Math.max(activeIndex, 0),
  Math.max(items.length - 1, 0),
);
const activeItem = items[safeActiveIndex];
```

`safeActiveIndex` clamps to a valid index across remove/reorder transitions.
Move/remove operations adjust `activeIndex` so the active selection follows
the moved item.

### GraphQL from an admin extension

```js
fetch("shopify:admin/api/graphql.json", {
  method: "POST",
  body: JSON.stringify({ query, variables }),
});
```

The `shopify:admin/api/graphql.json` URL is auto-authenticated — no token
handling needed. Use the same `$app` namespace and `metafieldsSet` mutation
as the embedded app.

### Icon-only buttons + tooltips

```jsx
<s-tooltip id="faq-tip-move-up">{t("moveUp")}</s-tooltip>
<s-button
  variant="tertiary"
  icon="arrow-up"
  accessibilityLabel={t("moveUp")}
  interestFor="faq-tip-move-up"
  disabled={...}
  onClick={...}
/>
```

**Use camelCase for `interestFor` and `accessibilityLabel`.** Despite the
"kebab-case for layout props" rule, these specific interaction props use
the JS property name in JSX (the underlying Polaris component reads them as
properties, not attributes).

### Localization

All non-merchant-editable text lives in `locales/en.default.json` and is
read via `shopify.i18n.translate(key, params)`:

```js
const { i18n } = shopify;
const t = (key, params) => i18n.translate(key, params);
// ...
<s-text-field label={t("question", { n: idx + 1 })} ... />
```

Every locale file MUST contain the same keys as `en.default.json` — Shopify's
build will fail if `fr.json` adds keys not in en.

---

## Surface 4: Theme app extension

[extensions/faq-block/blocks/faq.liquid](extensions/faq-block/blocks/faq.liquid)
renders the FAQ on the storefront. It's a standard `target: "section"` app
block with `enabled_on.templates: ["product","collection","article","blog","index","page"]`.

### Reading app metafields in Liquid

**Use bracket notation, not dot shorthand:**

```liquid
{%- assign metafield = product.metafields["$app"]["faq"] -%}
```

NOT this:

```liquid
{# DOES NOT WORK in many environments #}
{%- assign metafield = product.metafields.app.faq -%}
```

The `.app` shorthand depends on theme-extension-to-app association that
isn't reliably established (see Gotcha #2). The `["$app"]` bracket access
works universally because `$app` is recognized as a literal namespace token
by Liquid's metafield resolver.

### Auto-detect resource

The block walks through the available context objects:

```liquid
{%- if source == 'shop' -%}
  {%- assign metafield = shop.metafields["$app"]["faq"] -%}
{%- else -%}
  {%- if product != blank -%}
    {%- assign metafield = product.metafields["$app"]["faq"] -%}
  {%- elsif collection != blank -%}
    {%- assign metafield = collection.metafields["$app"]["faq"] -%}
  {%- elsif article != blank -%}
    {%- assign metafield = article.metafields["$app"]["faq"] -%}
  {%- elsif blog != blank -%}
    {%- assign metafield = blog.metafields["$app"]["faq"] -%}
  {%- endif -%}
  {%- if metafield == blank -%}
    {%- assign metafield = shop.metafields["$app"]["faq"] -%}
  {%- endif -%}
{%- endif -%}
```

Variants and markets are stored editable via the in-app editor but **not
rendered on the storefront** — variants need JS to swap on variant change;
markets aren't a template context and would need an app-embed block.

### Schema constraints

- **Setting types NOT supported in app blocks** (will fail TOML validation):
  - `color_scheme` (theme-only)
  - `color_scheme_group`
- **Non-interactive settings (`header`/`paragraph`) capped at 6.** The Colors
  hint that used to be a separate `paragraph` was folded into the Colors
  `header.info` field instead.
- **Available setting types:** `text`, `textarea`, `select`, `range`,
  `checkbox`, `color`, `color_background`, `font_picker`, `header`,
  `paragraph`, plus collection/product/blog/article/page/url pickers.

### Loading custom fonts

```liquid
{%- if font -%}
  {%- style -%}
    {{ font | font_face: font_display: 'swap' }}
  {%- endstyle -%}
{%- endif -%}
```

`font_picker` setting returns a Font object with `family`, `weight`, `style`,
`fallback_families`. Use them via CSS variables on the section element.

### Animating `<details>` open/close

```css
.shop-data-faq { interpolate-size: allow-keywords; }
.shop-data-faq__details::details-content {
  block-size: 0;
  overflow: clip;
  transition:
    block-size 0.3s ease,
    content-visibility 0.3s allow-discrete;
}
.shop-data-faq__details[open]::details-content {
  block-size: auto;
}
```

`interpolate-size: allow-keywords` + `::details-content` + `allow-discrete`
is the modern recipe for smooth accordion transitions. Browsers without
support fall back to the instant-toggle default.

### JSON-LD output

```liquid
{%- if block.settings.emit_jsonld -%}
  {%- capture faq_jsonld -%}
    { "@context": "https://schema.org", "@type": "FAQPage",
      "mainEntity": [
        {%- for item in items -%}
          { "@type": "Question",
            "name": {{ item.question | json }},
            "acceptedAnswer": {
              "@type": "Answer",
              "text": {{ item.answer | json }}
            }
          }{%- unless forloop.last -%},{%- endunless -%}
        {%- endfor -%}
      ]
    }
  {%- endcapture -%}
  <script type="application/ld+json">{{ faq_jsonld }}</script>
{%- endif -%}
```

The `| json` Liquid filter is **mandatory** to escape quotes in the question
and answer text correctly.

### Inline assets

`{% stylesheet %}` is **not allowed** in app blocks. CSS lives in
[extensions/faq-block/assets/faq.css](extensions/faq-block/assets/faq.css)
and is loaded via `{{ 'faq.css' | asset_url | stylesheet_tag }}`. Same for
JS: `<script src="{{ 'faq.js' | asset_url }}" defer></script>`.

---

## Admin link extensions (optional surface)

[extensions/faq-product-link/](extensions/faq-product-link/) and
[extensions/faq-product-index-link/](extensions/faq-product-index-link/) are
`type = "admin_link"` extensions with NO React/Preact code — pure TOML:

```toml
[[extensions.targeting]]
target = "admin.product-details.action.link"
url = "/app/blocks/faq?ownerType=PRODUCT"
```

The link appears in **More actions** on the targeted page. Clicking
navigates the merchant straight into the embedded app at the URL provided.

**Limitation:** the URL is static — there is no documented placeholder
syntax to inject the current product's ID into the URL. The product-detail
link therefore opens the editor in "pick a product" state, same as the
index link. Use `admin_action` with `target: ".action.render"` and a
modal+redirect if you genuinely need the resource ID.

---

## Gotchas (the bugs we hit, so you don't have to)

### 1. Variant TOML key is `variant`, not `product_variant`

The Shopify CLI's app-config validator rejects `[product_variant.metafields...]`
as "Unsupported section". The valid keys are the values in the CLI's owner-
type-to-enum map: `product`, `variant`, `collection`, `customer`, `order`,
`company`, `company_location`, `location`, `selling_plan`, `shop`, `market`,
`blog`, `article`, `page`, `draft_order`, `order_routing_location_rule`.

### 2. `metafields.app.<key>` Liquid shorthand is unreliable

The shorthand depends on the theme extension being deployed AND associated
with the owning app's namespace via Shopify's internal store-level mapping.
In dev mode and on freshly-deployed extensions, the resolution silently
returns `null`. The bracket form `metafields["$app"][<key>]` works
universally because `$app` is a literal token recognized by the resolver.

### 3. Polaris web components hold internal input state across re-renders

If you `key={idx}` a list of `<s-text-field>` items, removing item 0 leaves
the original DOM node in place but mutates its props. The web component does
NOT re-sync its visible value — typed text will appear to "stay behind" with
the wrong index. **Always use a stable per-item `_key`.** Same root cause
made the typing-while-empty bug: rendering `[emptyItem()]` on every render
re-keys the field on each keystroke, dropping characters.

### 4. App blocks cannot use `color_scheme` setting

`color_scheme` is a theme-level setting type only. App blocks (theme
extensions inside an app) get a CLI error: *"settings: color_scheme type is
invalid"*. Use individual `color` and `color_background` settings instead.

### 5. App blocks cannot scroll internally

Polaris admin block components only allow `overflow: hidden | visible` —
no `auto`/`scroll`. Native `<div style={{overflow: auto}}>` is filtered by
Remote DOM serialization. Admin blocks **grow with their content**; let the
parent product page scroll. If you need a bounded list, use the master/detail
pattern (one editable item on the left, clickable list on the right).

### 6. Admin extension iframes resize to content

The in-app `<s-page>` editor has a normal browser viewport, but admin
extensions render in iframes that auto-resize to their content. `max-height`
on inner divs is a no-op there. Use a fixed `height` if you must, or design
around the constraint.

### 7. Theme extension `target: section` schema caps at 6 non-interactive settings

`header` and `paragraph` count as non-interactive. Hitting 7 fails TOML
validation. Move hint copy into a `header.info` field (renders as a tooltip
on the header) instead of using a `paragraph`.

### 8. Locale files must all contain the same keys

If `en.default.json` has 5 keys and `fr.json` has 6, the build fails:
*"The dictionary for locale `fr` defines translation keys that are not present
in the default locale, en."* Keep them strictly in sync.

### 9. Polaris attribute casing rules

For most layout/style props use **kebab-case** (`align-items`,
`padding-block`, `border-radius`, `inline-size`). For interaction props
(`commandFor`, `interestFor`, `accessibilityLabel`) use **camelCase** in JSX.

### 10. React Router 7 and `.server.js` modules

A route file that exports a default React component cannot import from a
`.server.js` module unless every imported symbol is used only by `loader`
or `action`. Constants used by both server and client code must live in
non-`.server.js` files.

---

## Cookbook: adding a new block

To add `<your-block>`:

### 1. Register the block

Append to [app/blocks/registry.js](app/blocks/registry.js):

```js
{
  id: "your-block",
  title: "Your Block",
  description: "...",
  editorPath: "/app/blocks/your-block",
  scopes: [/* subset of OWNER_TYPES, with icons */],
}
```

### 2. Declare metafield definitions in `shopify.app.toml`

```toml
[product.metafields.app.your_block]
name = "Your Block"
type = "json"
[product.metafields.app.your_block.access]
admin = "merchant_read_write"
```

Repeat for each owner type your block supports. Use `variant`, `shop`,
`market`, `blog`, `article` (NOT `product_variant`).

### 3. Create the block module

```
app/blocks/your-block/
├── owner-types.js           # if your block needs different owner types
└── metafield.server.js      # readYourBlock, writeYourBlock, searchOwners (if needed)
```

You can usually reuse the FAQ owner types via
`import { OWNER_TYPES, getOwnerType } from "../faq/owner-types";`.
Better: extract `OWNER_TYPES` into a shared `app/blocks/_shared/owner-types.js`
on day 2.

### 4. Build the editor route

Create `app/routes/app.blocks.your-block.jsx`. Mirror
[app/routes/app.blocks.faq.jsx](app/routes/app.blocks.faq.jsx):

- `loader` reads `?ownerType` and `?ownerId` from URL
- `action` handles `intent=search` and `intent=save`
- Component holds `pending` map for multi-resource pending state
- `<SaveBar open={isDirty}>` from `@shopify/app-bridge-react`
- `useBlocker` + `shopify.saveBar.leaveConfirmation()` for navigation guards
- Stable `_key` on every list item

### 5. Build the theme app extension

```
shopify app generate extension --template theme_app_extension --name your-block-block
```

In `blocks/your-block.liquid`:
- Read with `metafields["$app"]["<key>"]` bracket access
- Use `enabled_on.templates` to limit page contexts
- Schema: ≤6 non-interactive settings, no `color_scheme`
- CSS in `assets/your-block.css`, JS in `assets/your-block.js`
- `<script type="application/ld+json">` for SEO if applicable

### 6. (Optional) Admin block on a resource page

```
shopify app generate extension --template admin_block --name your-block-product-block
```

Set `target = "admin.product-details.block.render"` in the toml. Reuse the
master/detail layout pattern. Localize all text via `shopify.i18n.translate`.

### 7. (Optional) Admin links

```
shopify app generate extension --template admin_link --name your-block-product-link
```

Set `target = "admin.product-details.action.link"` and `url = "/app/blocks/your-block?ownerType=PRODUCT"`.

### 8. Verify

```
shopify app config validate
shopify app build
npm run typecheck
npm run lint
```

Then `shopify app dev` to test on a dev store, and **`shopify app deploy`
once** to register every extension's app association — the theme extension's
`metafields["$app"]` resolution and admin extensions' menu placement both
require this initial deploy.

---

## Quick file-path reference

| Concern | File |
|---|---|
| Block registry | [app/blocks/registry.js](app/blocks/registry.js) |
| Shared owner types | [app/blocks/faq/owner-types.js](app/blocks/faq/owner-types.js) |
| Metafield helpers (server) | [app/blocks/faq/metafield.server.js](app/blocks/faq/metafield.server.js) |
| Dashboard | [app/routes/app._index.jsx](app/routes/app._index.jsx) |
| In-app FAQ editor | [app/routes/app.blocks.faq.jsx](app/routes/app.blocks.faq.jsx) |
| App shell / nav | [app/routes/app.jsx](app/routes/app.jsx) |
| Auth + Shopify config | [app/shopify.server.js](app/shopify.server.js) |
| Metafield TOML defs + scopes | [shopify.app.toml](shopify.app.toml) |
| Theme storefront block | [extensions/faq-block/blocks/faq.liquid](extensions/faq-block/blocks/faq.liquid) |
| Theme block CSS / JS | [extensions/faq-block/assets/](extensions/faq-block/assets/) |
| Admin product-page block | [extensions/faq-product-block/src/BlockExtension.jsx](extensions/faq-product-block/src/BlockExtension.jsx) |
| Admin link (product detail) | [extensions/faq-product-link/shopify.extension.toml](extensions/faq-product-link/shopify.extension.toml) |
| Admin link (product index) | [extensions/faq-product-index-link/shopify.extension.toml](extensions/faq-product-index-link/shopify.extension.toml) |

---

## Stack reference

- **Server framework:** React Router 7 (`@react-router/dev`)
- **Shopify app server adapter:** `@shopify/shopify-app-react-router`
- **Embedded app UI:** Polaris **web components** (`<s-page>`, `<s-section>`, `<s-stack>`, etc.) — NOT the React Polaris library
- **App Bridge:** `@shopify/app-bridge-react` (for SaveBar, resourcePicker, toast, intents)
- **Database:** Prisma + SQLite for **session storage only**. Block data lives in Shopify metafields, not Prisma.
- **Admin API version:** `2025-10` (set in [app/shopify.server.js](app/shopify.server.js) and extension toml files)
- **Webhook API version:** `2026-07` (set in [shopify.app.toml](shopify.app.toml))
