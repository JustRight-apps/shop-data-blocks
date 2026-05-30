// Served at /robots.txt — disallow all crawlers on this domain.
// just-right.net hosts only the embedded app and its APIs; the public,
// crawlable marketing site will live on a separate domain.
export const loader = () => {
  const body = ["User-agent: *", "Disallow: /", ""].join("\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "public, max-age=86400",
    },
  });
};
