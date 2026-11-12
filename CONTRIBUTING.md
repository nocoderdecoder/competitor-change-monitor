# Contributing

Report a problem with a minimal public or synthetic HTML example, the page filters, the prior snapshot, and the resulting digest. A useful report explains which text should or should not have changed.

Keep extraction and comparison deterministic. Preserve the last successful snapshot when a fetch fails. A first run should establish a baseline, not announce every line as new.

Run `npm test` and `npm run build:workflow` before opening a pull request. Include the generated workflow when changing shared comparison logic. Do not add credentials, private watchlists, or captured customer data.
