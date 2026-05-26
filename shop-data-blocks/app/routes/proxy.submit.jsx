import { authenticate } from "../shopify.server";
import { appendQuestion, getShop } from "../blocks/questions/server";
import { sendCustomerMessagedEmail } from "../lib/email.server";
import { merchantInboxUrl, productStorefrontUrl } from "../lib/urls.server";

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.public.appProxy(request);
  if (!admin || !session) {
    return Response.json({ ok: false, error: "Shop session unavailable." }, { status: 401 });
  }

  const url = new URL(request.url);
  const loggedInCustomerId = url.searchParams.get("logged_in_customer_id");
  if (!loggedInCustomerId) {
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
    }
  } catch (error) {
    console.warn("Failed to send merchant notification email:", error.message);
  }

  return Response.json({ ok: true, id: result.thread.id });
};
