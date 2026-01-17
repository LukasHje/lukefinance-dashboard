# Luke Finance Dashboard

## Run locally

```bash
npm install
npm run start
```

Then open http://127.0.0.1:4173/ in your browser.

## Troubleshooting

- If the page shows "Error loading plan", confirm `public/plan.json` exists and that you opened `http://127.0.0.1:4173/`.
- If the error panel lists validation issues, check that `plan.json` includes a non-empty `stages` array and each stage has `name` and `from` in `YYYY-MM`.
- If you see "State not saved (server offline)", the app is running in-memory; restart `npm run start` and reload.
- If changes are not appearing, hard refresh the browser or disable cache in devtools.
