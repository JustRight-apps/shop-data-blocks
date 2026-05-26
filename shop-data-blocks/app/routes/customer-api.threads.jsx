import { unauthenticated } from "../shopify.server";
import {
  handleCorsPreflight,
  verifyCustomerAccountRequest,
  withCors,
} from "../lib/customer-account-auth.server";
import { readCustomer } from "../blocks/questions/server";

export const loader = async ({ request }) => {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;

  const { shopDomain, customerGid } = await verifyCustomerAccountRequest(request);
  const { admin } = await unauthenticated.admin(shopDomain);

  const customer = await readCustomer(admin, customerGid);
  return withCors(
    Response.json({
      threads: customer.threads,
    }),
  );
};

export const action = async ({ request }) => {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;
  return withCors(new Response("Method not allowed", { status: 405 }));
};
