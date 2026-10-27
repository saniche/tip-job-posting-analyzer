// Zero-dependency mock of your server, for testing the extension locally.
//   node mock-server.mjs                      (job takes ~12s)
//   DURATION_MS=60000 node mock-server.mjs    (slow jobs, to test the 10-job pool)
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 8000);
const DURATION = Number(process.env.DURATION_MS ?? 12_000);

let validToken = null;        // GET /admin/expire clears it -> next request gets 401
const jobs = new Map();       // processing_job_id -> { url, startedAt }

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  console.log(req.method, pathname);

  // --- static test pages: /page/1, /page/2, ... (a slug containing "fail" makes the job fail) ---
  const page = pathname.match(/^\/page\/(.+)$/);
  if (req.method === 'GET' && page) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><title>Job ${page[1]}</title>
      <h1>Senior Developer (${page[1]})</h1>
      <p>Acme Corp, Ottawa, ON. Full-time. Salary 100,000-120,000 CAD.</p>
      <h2>Responsibilities</h2><p>Design, build and maintain services. Work with product and QA.</p>
      <h2>Requirements</h2><p>5+ years of experience, C# or TypeScript, SQL.</p>
      <p>Apply now.</p>`);
  }

  if (req.method === 'GET' && pathname === '/admin/expire') {
    validToken = null;
    return json(res, 200, { expired: true });
  }

  if (req.method === 'POST' && pathname === '/auth/login') {
    const { username, password } = await readBody(req);
    if (username === 'demo' && password === 'demo') {
      validToken = randomUUID();
      return json(res, 200, { access_token: validToken, token_type: 'bearer' });
    }
    return json(res, 401, { detail: 'Invalid credentials' });
  }

  // --- everything below needs the Bearer token ---
  if (!validToken || req.headers.authorization !== `Bearer ${validToken}`) {
    console.log('  -> 401');
    return json(res, 401, { detail: 'Not authenticated' });
  }

  if (req.method === 'POST' && pathname === '/jobs/analyze') {
    const { url, content } = await readBody(req);
    if (typeof url !== 'string' || typeof content !== 'string') return json(res, 422, { detail: 'url and content must be strings' });
    let kind = 'raw text';
    try { if (typeof JSON.parse(content) === 'string') kind = 'JSON-encoded string'; } catch { /* raw */ }
    console.log(`  url=${url}\n  content: ${content.length} chars, ${kind}, starts: ${content.slice(0, 80).replace(/\s+/g, ' ')}`);

    const processingJobId = randomUUID();
    jobs.set(processingJobId, { url, startedAt: Date.now() });
    return json(res, 202, {
      id: randomUUID(), status: 'pending', processing_job_id: processingJobId,
      title: null, url, created_at: new Date().toISOString(),
    });
  }

  const pj = pathname.match(/^\/processing-jobs\/(.+)$/);
  if (req.method === 'GET' && pj) {
    const job = jobs.get(pj[1]);
    if (!job) return json(res, 404, { detail: 'Unknown processing job' });
    const elapsed = Date.now() - job.startedAt;
    let status = elapsed < DURATION * 0.3 ? 'pending' : elapsed < DURATION ? 'processing' : 'completed';
    if (status === 'completed' && job.url.includes('fail')) {
      return json(res, 200, { id: pj[1], status: 'failed', result_id: null, error: 'Simulated failure' });
    }
    return json(res, 200, { id: pj[1], status, result_id: status === 'completed' ? pj[1] : null, error: null });
  }

  const rs = pathname.match(/^\/results\/(.+)$/);
  if (req.method === 'GET' && rs) {
    const job = jobs.get(rs[1]);
    if (!job) return json(res, 404, { detail: 'Unknown result' });
    return json(res, 200, { summary: `Mock analysis of ${job.url}`, score: 87, skills: ['C#', 'TypeScript', 'SQL'] });
  }

  json(res, 404, { detail: 'Not found' });
}).listen(PORT, () => console.log(`Mock server on http://localhost:${PORT}  (job duration ${DURATION} ms, login demo/demo)`));
