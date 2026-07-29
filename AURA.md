# Aura Standing Rules

## Surfaces
This repo publishes to three separate places that share one git
tree: the website (`index.html`, served at enables.vercel.app), the
repo page (`README.md`), and the npm CLI (`src/`). They are not the
same thing and a change to one does not change the others.

When the request says website, site, landing page or page, edit
`index.html` and nothing else. When it says repo, readme or github,
edit `README.md` and nothing else. Putting an image "in the repo"
means commit it to `assets/` and reference it from `README.md` — it
never means adding it to `index.html`. Removing an image "from the
website" means deleting the `<img>` from `index.html`; it does not
mean deleting the file from `assets/`, which the README may use.

Committing an asset and displaying it are two separate steps. Do
only the one asked. Never mirror an edit onto a second surface to be
helpful; that is scope creep, not thoroughness. If you cannot tell
which surface is meant, stop and ask — one question costs 50 tokens,
guessing wrong here cost 100 turns and 2.5M tokens on 2026-07-29,
when `b19c84d6` put a screenshot on the website when the README was
meant, and `d3852451`+`5b9d08b6` were needed to undo it.

## Verify before reporting done
Vercel rewrites every path to `/index.html` and caches aggressively.
After editing, check raw.githubusercontent.com first, then the live
URL. A stale response does not mean the commit failed. Always name
the exact file you changed instead of reporting "done".

## Secrets
Never inline a token into a shell command. Use `gh`, which reads its
own keyring, or read from `.env` — see `.env.example`. A `ghp_` PAT
was leaked in plaintext this way on 2026-07-29.
