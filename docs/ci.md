# CI and deployment

**CI** runs on pull requests and pushes to main. The **App checks** job uses Node 22 and the pnpm version pinned in package.json. It installs from the frozen lockfile and runs lint, typecheck, Vitest, and the production build without application credentials. The optional live Jev test stays skipped.

The env-file guard rejects tracked .env files except for the root .env.example and checks that credential assignments in the template are empty. The public env guard rejects credential-like names and values and reuse of configured server secrets in NEXT_PUBLIC_ variables. The bundle guard scans .next/static for server-only env names. **Secret scan** runs Gitleaks over incoming PR commits and the reachable history of main on pushes. Findings redact matched values.

The Playwright workflow is tracked in HAC-29 and runs separately. Vercel's GitHub integration handles preview and production builds. [Vercel environments](https://vercel.com/docs/environment-variables)

| Variable                                         | Production                                                  | Preview                            | Development                      |
| ------------------------------------------------ | ----------------------------------------------------------- | ---------------------------------- | -------------------------------- |
| DATABASE_URL                                     | Production Neon                                             | Isolated preview Neon              | Local or development Neon        |
| OPENAI_API_KEY                                   | Runtime model provider                                      | Scoped test provider if enabled    | Optional developer credential    |
| OPENAI_MODEL                                     | Optional compatible model override                          | Optional compatible model override | Optional; defaults to gpt-6-luna |
| JEV_API_KEY (+ optional JEV_BASE_URL, JEV_MODEL) | Runtime panel if enabled                                    | Scoped test panel if enabled       | Optional for live panel tests    |
| CENSUS_API_KEY                                   | Omit from app runtime                                       | Omit from app runtime              | Optional for data preparation    |
| MATTERPORT_SDK_KEY                               | Client-permitted Showcase key if approved                   | Optional for approved scan display | Optional; fixtures need none     |
| MATTERPORT_API_TOKEN                             | Server-only TokenID:TokenSecret; activation gated by HAC-14 | Omit until access is approved      | Optional; fixtures need none     |

Keep application secrets in the relevant Vercel environment or in local .env.local. Use separate preview and production credentials and keep credentials out of NEXT_PUBLIC_ variables.

The bundle guard also checks configured server-only values, including
`MATTERPORT_API_TOKEN`, without printing them. The Showcase key is explicitly
client-permitted through a reviewed application response; this does not add a
`NEXT_PUBLIC_` credential-name exception. Interior display remains closed until
HAC-14 access/terms activation; see [interior-api.md](interior-api.md).

## Required checks for main

- **App checks**
- **Secret scan**

Select these job names from a successful CI run when configuring branch protection.

## Local containers

`compose.yaml` provides an arm64/amd64 PostGIS development database and optional
non-root app container. See [local-postgis.md](local-postgis.md) for setup,
`db:load`, real-data verification and safe reset. Ordinary CI remains
credential-free and does not fetch licensed data or start this stack. A future
authorized integration job may reuse the database with synthetic fixtures; do
not expose sponsor kits or private env files to untrusted PR jobs.
