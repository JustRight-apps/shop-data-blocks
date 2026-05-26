import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received GDPR webhook ${topic} for ${shop}`, {
    shop,
    topic,
    payloadKeys: payload ? Object.keys(payload) : null,
  });

  // TODO: implement deletion/export per topic
  //   - customers/data_request: respond with the customer's data (questions on their metafield)
  //   - customers/redact:        delete the customer's questions metafield AND remove their rows
  //                              from shop.question_inbox
  //   - shop/redact:             delete shop.question_inbox metafield

  return new Response();
};
