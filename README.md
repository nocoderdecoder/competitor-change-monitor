# Competitor Change Monitor

Compare public product or pricing pages with their previous snapshots. The digest shows added and removed text, source URLs, and the times each snapshot was taken. It makes no inference about a competitor's intent.

The repository includes a local command-line tool and an n8n workflow. Neither requires an LLM or paid API. The [sample digest](examples/digest.md) shows changes in a synthetic pricing page.

## Local use

Node.js 22 or later is required. No packages need to be installed.

```sh
node examples/demo.mjs
node src/cli.mjs examples/config.json
```

Copy `examples/config.json` and replace the example URL with the final HTTPS URLs of pages permitted to be monitored. Optional `include` terms keep matching lines; `ignore` terms remove matching lines. Both are case-insensitive literal text matches.

```json
{
  "pages": [
    {
      "name": "Example pricing",
      "url": "https://example.com/pricing",
      "include": ["month", "seat", "annual"],
      "ignore": ["copyright"]
    }
  ]
}
```

The first successful run establishes a baseline. A later run compares against the last successful snapshot. By default, state and the latest digest are stored under `.monitor/`, which is excluded from Git.

```sh
node src/cli.mjs pages.json --state .monitor/snapshots.json --out .monitor/digest.md
```

Use one process at a time for a state file. Exit code 1 means at least one page failed; the digest includes those failures and preserves earlier snapshots for those pages. Exit code 2 indicates invalid configuration or another fatal error.

## n8n

1. Import `n8n/competitor-page-changes.json` into n8n.
2. Edit the **Pages** node with approved public URLs and optional text filters.
3. Run manually to inspect the fetched text and digest.
4. Choose the workflow timezone and schedule. The bundled schedule is Monday at 09:00 UTC, and the workflow is inactive on import.
5. Publish the workflow to persist snapshots between scheduled executions. Manual test runs do not persist n8n static data. The first production run creates a baseline.
6. The **Build digest** node returns a `markdown` field plus structured results. Connect an email, chat, or storage destination if needed, using credentials configured in n8n.

The template uses n8n's experimental workflow static data for a small set of pages. Keep at most 10 pages, avoid overlapping executions, and narrow filters to retain no more than 20 KB of text per page. For larger or concurrent use, replace snapshot storage with a database or n8n Data Table.

Redirects are disabled in the template; enter the final page URL. The local CLI follows up to three redirects and checks each destination. The template's HTTP Request node relies on the n8n host's network controls, so the page list must be maintained by a trusted operator. Do not expose it as a public URL-submission service.

## Behavior and limits

- Only static HTML or plain text is read. Pages that require JavaScript, login, or a CAPTCHA need a different retrieval method.
- Text extraction removes scripts and styles, then compares normalized lines. It is not a rendered-browser comparison. Layout or navigation edits can still appear in a digest.
- Whitespace and line order do not count as changes. Repeated lines are counted, so removing one of two identical lines is still a change.
- Changing a URL or text filter starts a new baseline for that selection.
- A failed fetch, empty result, or oversized selection keeps the earlier snapshot. Access-denied pages that return HTTP 200 can still require manual review.
- Use public pages where automated access is permitted, respect site terms and rate limits, and keep the watchlist small. The tool does not bypass access controls or interpret robots.txt automatically.

The scripts collect no telemetry. Fetching a page sends a normal HTTP request to its host. Snapshots stay in the configured local state file or n8n instance.

## Development

```sh
npm test
npm run build:workflow
```

The workflow is generated from `src/core.mjs`; update the source and rebuild it before committing. See [TESTING.md](TESTING.md) for validation scope and [CONTRIBUTING.md](CONTRIBUTING.md) for changes. MIT licensed.
