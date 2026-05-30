import { authenticate } from "../shopify.server";
import { appendQuestion, getShop } from "../blocks/questions/server";
import { sendCustomerMessagedEmail } from "../lib/email.server";
import { merchantInboxUrl, productStorefrontUrl } from "../lib/urls.server";
import { logQuestion, logQuestionError } from "../lib/log.server";

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.public.appProxy(request);
  if (!admin || !session) {
    logQuestionError("question.submit.no_session", "Shop session unavailable");
    return Response.json({ ok: false, error: "Shop session unavailable." }, { status: 401 });
  }

  const url = new URL(request.url);
  const loggedInCustomerId = url.searchParams.get("logged_in_customer_id");
  logQuestion("question.submit.received", {
    shop: session.shop,
    logged_in: Boolean(loggedInCustomerId),
  });
  if (!loggedInCustomerId) {
    logQuestion("question.submit.rejected", {
      shop: session.shop,
      reason: "not_logged_in",
    });
    return Response.json(
      { ok: false, error: "You must be logged in to ask a question." },
      { status: 401 },
    );
  }
  const customerGid = `gid://shopify/Customer/${loggedInCustomerId}`;

  const formData = await request.formData();
  const productId = String(formData.get("product_id") ?? "").trim();
  const text = String(formData.get("text") ?? "");
  if (!productId.startsWith("gid://shopify/Product/")) {
    logQuestion("question.submit.rejected", {
      shop: session.shop,
      customer_id: customerGid,
      reason: "invalid_product",
      product_id: productId,
    });
    return Response.json({ ok: false, error: "Invalid product." }, { status: 400 });
  }

  let result;
  try {
    result = await appendQuestion(admin, {
      customerId: customerGid,
      productId,
      text,
    });
  } catch (error) {
    logQuestionError("question.submit.failed", error, {
      shop: session.shop,
      customer_id: customerGid,
      product_id: productId,
    });
    return Response.json(
      { ok: false, error: error.message ?? "Failed to submit question." },
      { status: 400 },
    );
  }

  try {
    const shop = await getShop(admin);
    if (shop.email) {
      await sendCustomerMessagedEmail({
        to: shop.email,
        customerName: result.customer.name,
        productTitle: result.product.title,
        productUrl: productStorefrontUrl(session.shop, result.product.handle),
        message: text,
        inboxUrl: merchantInboxUrl(session.shop),
      });
      logQuestion("question.submit.email_sent", {
        thread_id: result.thread.id,
        to: shop.email,
      });
    }
  } catch (error) {
    logQuestionError("question.submit.email_failed", error, {
      thread_id: result.thread.id,
    });
  }

  logQuestion("question.submit.ok", {
    shop: session.shop,
    thread_id: result.thread.id,
    customer_id: customerGid,
    product_id: productId,
  });
  return Response.json({ ok: true, id: result.thread.id });
};
