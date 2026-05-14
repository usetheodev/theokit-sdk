export function register(ctx) {
  ctx.registerProvider("web_search", {
    name: "fixture-search",
    displayName: "Fixture Search",
    isAvailable() {
      return Boolean(process.env.FIXTURE_SEARCH_TOKEN);
    },
  });
}
