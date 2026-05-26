import { unauthenticated } from "../shopify.server";
import {
  handleCorsPreflight,
  verifyCustomerAccountRequest,
  withCors,
} from "../lib/customer-account-auth.server";
import {
  appendMessage,
  getShop,
} from "../blocks/questions/server";
import { MESSAGE_AUTHOR } from "../blocks/questions/constants";
import { sendCustomerMessagedEmail } from "../lib/email.server";
import { merchantInboxUrl, productStorefrontUrl } from "../lib/urls.server";

export const action = async ({ request }) => {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;

  const { shopDomain, customerGid } = await verifyCustomerAccountRequest(request);
  const { admin } = await unauthenticated.admin(shopDomain);

  let body;
  try {
    body = await request.json();
  } catch {
    return withCors(Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 }));
  }

  const threadId = String(body?.thread_id ?? "").trim();
  const text = String(body?.text ?? "");
  if (!threadId) {
    return withCors(Response.json({ ok: false, error: "thread_id is required." }, { status: 400 }));
  }

  let result;
  try {
    result = await appendMessage(admin, {
      customerId: customerGid,
      threadId,
      author: MESSAGE_AUTHOR.CUSTOMER,
      text,
    });
  } catch (error) {
    return withCors(
      Response.json({ ok: false, error: error.message ?? "Failed to reply." }, { status: 400 }),
    );
  }

  try {
    const shop = await getShop(admin);
    if (shop.email) {
      await sendCustomerMessagedEmail({
        to: shop.email,
        customerName: result.customer.name,
        productTitle: result.thread.product_title,
        productUrl: productStorefrontUrl(shopDomain, result.thread.product_handle),
        message: text,
        inboxUrl: merchantInboxUrl(shopDomain),
      });
    }
  } catch (error) {
    console.warn("Failed to send merchant notification email:", error.message);
  }

  return withCors(Response.json({ ok: true }));
};

export const loader = async ({ request }) => {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;
  return withCors(new Response("Method not allowed", { status: 405 }));
};
