import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { blocks } from "../blocks/registry";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return { blocks };
};

export default function Index() {
  const { blocks: items } = useLoaderData();

  return (
    <s-page heading="Shop data blocks">
      <s-section heading="Your blocks">
        <s-paragraph>
          Each block lets you attach data to a Shopify resource and render it
          on the storefront via a theme app extension. Open an editor below to
          start adding data.
        </s-paragraph>
      </s-section>

      {items.map((block) => {
        const menuId = `scope-menu-${block.id}`;
        return (
          <s-section key={block.id} heading={block.title}>
            <s-stack direction="block" gap="base">
              <s-paragraph>{block.description}</s-paragraph>
              <s-button variant="primary" commandFor={menuId}>
                Open editor
              </s-button>
              <s-menu
                id={menuId}
                accessibilityLabel={`Choose ${block.title} scope`}
              >
                {block.scopes.map((scope) => (
                  <s-button
                    key={scope.value}
                    icon={scope.icon}
                    href={`${block.editorPath}?ownerType=${scope.value}`}
                  >
                    {scope.label}
                  </s-button>
                ))}
              </s-menu>
            </s-stack>
          </s-section>
        );
      })}
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
