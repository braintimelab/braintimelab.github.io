# Braintime Lab

Public lab website: **https://braintimelab.github.io/**

- Public research, members, publications, lectures and resources recreate the official [TMU lab website](https://braintime.tmu.edu.tw/), as retrieved on 2026-10-15.
- [Internal tools](https://braintimelab.github.io/internal/) verifies Supabase Auth and active lab membership before presenting tools.
- [Braintime Mouse Data](https://braintimelab.github.io/mouse-data/) uses the existing private colony. Static files contain no animal data, member directory, private Sheet exports or server secrets.
- Reagents is a coming-soon tool; no reagent data has been imported here.

GitHub Pages publishes the root of `master`. `.nojekyll` prevents Jekyll processing. The earlier LocomotorBox code remains in its original paths; its documentation is in [LOCOMOTORBOX.md](LOCOMOTORBOX.md). The old site is recoverable from commit `076f724` and the `before-lab-homepage-2026-10-15` tag.

## Update Mouse Data

The app source remains in [JihwanMyung/braintime-mouse-data](https://github.com/JihwanMyung/braintime-mouse-data). From this checkout:

```
node scripts/sync-mouse-app.mjs /absolute/path/to/colony-app
node --test tests/*.test.mjs
```

The script copies only the app's explicit publication allowlist to a clean temporary package, runs its credential/asset checks, and synchronizes those approved assets into `mouse-data/`. It refuses unexpected files and does not push. Review the diff and publish the exact reviewed files. Never copy the private reconstruction workspace into this repository.

## Authentication and transition

Production Supabase Auth Site URL and `USER_MANAGEMENT_APP_URL` are `https://braintimelab.github.io/mouse-data/`. Exact new root and `index.html` callbacks are allowed. Keep the previous personal app root and `index.html` callbacks available for already-issued links during the transition. The previous deployment shows a moved notice and retains local-export/password-recovery access; it never copies credentials or local records to the new origin.

`internal/` and `mouse-data/` share same-origin, same-tab session storage. The tools portal uses the app's existing Auth code and a live membership check, without pulling colony records. Private-data access is enforced by Supabase, not by hidden links or `robots.txt`. Do not add untrusted third-party scripts to either the public website or internal tools. Browser sessions and installed app shortcuts from the old domain do not migrate automatically.

## Local preview

```
python3 -m http.server 8790 --bind 127.0.0.1
```

Local previews can verify presentation and mocked authorization tests; username sign-in/reset use the configured production origin. Authenticate on the deployed HTTPS site for live use. Sending real invitations or reset emails requires a verified transactional mail sender in Supabase; ordinary member delivery is not enabled merely by publishing this website.
