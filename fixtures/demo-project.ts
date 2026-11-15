/**
 * HAC-136: the seeded demo project. It is the one project with hand-built example sites
 * (Montrose and the Heights); `scripts/load-hosted-data.ts` and the e2e seeds insert its row.
 * Every real founder gets their own generated project ID instead (lib/projects/ids.ts).
 */
export const DEMO_PROJECT_ID = "houston-coffee";

export const demoPreviewProject = {
  id: DEMO_PROJECT_ID,
  name: "Houston coffee shop",
  city: "Houston, TX",
  business: "Coffee shop",
  sites: [
    {
      id: "montrose",
      address: "Montrose storefront",
      neighborhood: "Montrose",
      squareFeet: 1450,
    },
    {
      id: "heights",
      address: "Heights storefront",
      neighborhood: "The Heights",
      squareFeet: 1820,
    },
  ],
};
