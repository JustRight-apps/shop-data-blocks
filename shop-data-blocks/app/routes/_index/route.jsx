import { redirect } from "react-router";

// The root has no page of its own — it only forwards into the embedded app.
// Shopify opens the app at `/` with entry params (shop, host, embedded, …);
// we preserve them so the admin iframe lands on the app home at /app.
export const loader = async ({ request }) => {
  const qs = new URL(request.url).searchParams.toString();
  throw redirect(qs ? `/app?${qs}` : "/app");
};
