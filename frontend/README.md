# Resume Studio Frontend

Vite React + TypeScript frontend for the local Resume Studio workbench.

```bash
pnpm install
pnpm dev
pnpm test --run
pnpm build
```

The dev server proxies `/api` and `/variants` to FastAPI on
`http://127.0.0.1:8765`. Run `pnpm dev` from the repository root for the
one-command backend + frontend workflow.
