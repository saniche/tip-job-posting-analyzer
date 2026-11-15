# Job Posting Analyzer (MV3, TypeScript)

    npm i && npm run build      # then chrome://extensions > Developer mode > Load unpacked > select the dist/ folder (it must contain manifest.json)

Requires Node.js 20.12 or later. Set `API_BASE` in a root `.env` file (for example,
`API_BASE=https://example.com/api/v1`) or in the environment when building to override
the default `http://localhost:8000/api/v1`. Environment variables take precedence
over `.env`. The URL is embedded in the extension and must not contain secrets.
The build sets the matching host permission in `dist/manifest.json`. After changing
the URL, rebuild and reload the extension in Chrome. Configure `ENDPOINTS` in
src/shared/config.ts.
Same auth, endpoints, job pool (max 10 active) and polling as the generic Page Analyzer.
Endpoint paths are relative to `API_BASE`, including its path prefix: for example,
`/jobs/normalize` with `http://localhost:8000/api/v1` resolves to
`http://localhost:8000/api/v1/jobs/normalize`. Absolute URLs must have the same origin.

## Authentication
The login response must contain `access_token`. The extension treats the token as valid for
23 hours and 50 minutes locally, leaving a 10-minute margin before its 24-hour server lifetime.
Session storage is cleared when the browser closes; a server 401 also requires signing in again.

## What it sends
`POST /jobs/normalize` {url, content}
- `url`: the tab's URL
- `content`: `JSON.stringify(<job full text>)`: the page's full visible text (`document.body.innerText`) as it stands,
  or the highlighted text if the user selected some. Capped at MAX_CONTENT_CHARS (src/shared/config.ts).
  If the server wants the raw text instead of a JSON-encoded string, drop the `JSON.stringify` in `startJob()` (jobs.ts).

Duplicate detection ignores `#fragment` and tracking params (utm_*, gclid, fbclid, trk*, ref, refId, mc_*): the same
posting can't be submitted again while it is waiting/pending/processing.

## Polling / results
`GET /processing-jobs/{processing_job_id}` (pending|processing|completed|failed; `running`/`done` also accepted), then the
result is loaded from ENDPOINTS.result (assumed `GET /results/{result_id}`). Client polls 2s -> 10s with backoff.

## Local testing
For the mock server, build with `API_BASE` set to `http://localhost:8000` and set
the analyze endpoint to `/jobs/analyze` in config.ts.
Run `npm run mock` (login demo/demo), build, and load dist/ unpacked. Test pages: http://localhost:8000/page/1, /page/2, ...
(a slug containing "fail" makes the job fail). `DURATION_MS=60000 npm run mock` for slow jobs; `GET /admin/expire` invalidates the token.
For the real server, restore the analyze endpoint and build with the appropriate `API_BASE`.
