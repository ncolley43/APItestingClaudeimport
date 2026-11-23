import { test as base, expect, APIRequestContext } from '@playwright/test';
import * as fs from 'fs';

/**
 * Records every API call a test makes (what was sent, what came back) and, when the test finishes,
 * writes a results file for that test:
 *   - saved as test-results/<test folder>/api-results.txt
 *   - attached to the test in the HTML report ("api-results")
 *
 * Use `test` and `expect` from this file instead of '@playwright/test'.
 */

export interface ApiCall {
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  params?: unknown;
  requestBody?: unknown;
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  durationMs: number;
  error?: string;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'fetch'] as const;
const MAX_BODY_CHARS = 4000;

/** Wraps a request context so every call it makes is pushed to `log`. */
export function withLogging(ctx: APIRequestContext, log: ApiCall[], defaultHeaders: Record<string, string> = {}): APIRequestContext {
  return new Proxy(ctx, {
    get(target, prop) {
      const orig = Reflect.get(target, prop, target);
      if (typeof prop === 'string' && (METHODS as readonly string[]).includes(prop)) {
        return async (url: string, options: any = {}) => {
          const call: ApiCall = {
            method: prop === 'fetch' ? (options.method ?? 'GET').toUpperCase() : prop.toUpperCase(),
            url: String(url),
            requestHeaders: { ...defaultHeaders, ...(options.headers ?? {}) },
            params: options.params,
            requestBody: options.data ?? options.form ?? options.multipart,
            durationMs: 0,
          };
          const start = Date.now();
          try {
            const res = await orig.call(target, url, options);
            call.durationMs = Date.now() - start;
            call.url = res.url(); // full URL including query string
            call.status = res.status();
            call.statusText = res.statusText();
            call.responseHeaders = res.headers();
            try {
              call.responseBody = await res.text();
            } catch {
              call.responseBody = '(body could not be read)';
            }
            return res;
          } catch (e) {
            call.durationMs = Date.now() - start;
            call.error = String(e);
            throw e;
          } finally {
            log.push(call);
          }
        };
      }
      return typeof orig === 'function' ? orig.bind(target) : orig;
    },
  });
}

function pretty(body: unknown): string {
  if (body === undefined || body === null || body === '') return '(none)';
  let text: string;
  if (typeof body === 'string') {
    try {
      text = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      text = body;
    }
  } else {
    text = JSON.stringify(body, null, 2);
  }
  return text.length > MAX_BODY_CHARS
    ? `${text.slice(0, MAX_BODY_CHARS)}\n... (truncated – ${text.length} characters in total)`
    : text;
}

/** Headers whose values are hidden in the results file (auth tokens). */
const SECRET_HEADERS = ['cookie', 'authorization', 'set-cookie'];

const headerLines = (h: Record<string, string> = {}) =>
  Object.keys(h).length
    ? Object.entries(h).map(([k, v]) => `  ${k}: ${SECRET_HEADERS.includes(k.toLowerCase()) ? '***hidden***' : v}`).join('\n')
    : '  (none)';

function formatResults(title: string, status: string, duration: number, annotations: { type: string; description?: string }[], log: ApiCall[]): string {
  const lines: string[] = [
    title,
    `Result: ${status.toUpperCase()} (${duration} ms)`,
    ...annotations.map((a) => `${a.type}: ${a.description ?? ''}`),
    '',
    `API calls made: ${log.length}`,
  ];
  log.forEach((c, i) => {
    lines.push(
      '',
      `==================== Call ${i + 1} of ${log.length} ====================`,
      '--- REQUEST ---',
      `${c.method} ${c.url}`,
      'Headers:',
      headerLines(c.requestHeaders),
      ...(c.params ? ['Query parameters:', pretty(c.params)] : []),
      'Body:',
      pretty(c.requestBody),
      '',
      `--- RESPONSE (${c.durationMs} ms) ---`,
      ...(c.error
        ? [`Request failed: ${c.error}`]
        : [`HTTP ${c.status} ${c.statusText ?? ''}`.trim(), 'Headers:', headerLines(c.responseHeaders), 'Body:', pretty(c.responseBody)]),
    );
  });
  return lines.join('\n') + '\n';
}

export const test = base.extend<{ apiLog: ApiCall[] }>({
  apiLog: async ({}, use, testInfo) => {
    const log: ApiCall[] = [];
    await use(log);
    // Runs after the test (and its assertions) has finished, so status and Expected/Actual are known
    const file = testInfo.outputPath('api-results.txt');
    fs.writeFileSync(file, formatResults(testInfo.title, testInfo.status ?? 'unknown', testInfo.duration, testInfo.annotations, log));
    await testInfo.attach('api-results', { path: file, contentType: 'text/plain' });
  },

  // Replace the built-in `request` with one that records every call
  request: async ({ request, apiLog, extraHTTPHeaders }, use) => {
    await use(withLogging(request, apiLog, extraHTTPHeaders ?? {}));
  },
});

export { expect };
