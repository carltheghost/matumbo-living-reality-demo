# maTumbo Living Reality — permanent deployment

The public app is a static browser application. It does **not** require Codex,
ChatGPT, a local Node process, or a running tunnel after deployment.

## Deployment

The workflow at `.github/workflows/deploy-pages.yml` publishes the `main`
branch to GitHub Pages whenever a change lands on `main`.

The resulting address is the repository's GitHub Pages URL:

`https://carltheghost.github.io/matumbo-living-reality-demo/`

If GitHub Pages has not been enabled for the repository yet, open the repository
Settings → Pages and select **GitHub Actions** as the build/deployment source
once. After that, pushes to `main` deploy automatically.

## What this solves

- The app remains available when Codex is offline.
- The app remains available when this ChatGPT conversation is closed.
- Any browser can open the same URL.
- A phone can open the same URL without installing anything.
- GitHub remains the source of truth; deployment is reproducible from `main`.

## Boundary

This deployment hosts the existing local/simulation application. It does not
turn TUMBO-SIM into real money, add wallet custody, add signing, or create an
external execution service. Provider-backed read surfaces remain governed by
their existing explicit-refresh boundaries.

For a production custom domain or a second hosting provider, add the domain
at the hosting provider and point it at the deployed site. The application
itself remains independent of Codex.
