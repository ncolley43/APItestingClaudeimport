import { APIRequestContext, APIResponse } from '@playwright/test';
import { test, expect, withLogging } from './fixtures';
import { actual, createBooking, deleteBooking, expected, expectNoServerError, getToken, ids } from './helpers';

/**
 * Booking - GetBookingIds (GET /booking)
 * Test IDs match the "GetBookingIds API – Test Cases" sheet (TC-01 .. TC-44).
 *
 * beforeAll creates unique test data for this run so nothing depends on, or clashes with,
 * other people's data on the shared restful-booker demo. afterAll deletes it.
 *
 * Every test records an "Expected" and an "Actual" annotation, shown in the HTML report.
 * "Actual" is recorded before the assertions so it is visible even when a test fails.
 *
 * Every API call a test makes (request sent + response returned) is written to a results file
 * per test – see fixtures.ts.
 */

// Unique run id and names
const run = Date.now().toString(36);
const fn = `Fn${run}`;
const ln = `Ln${run}`;
const other = `Ot${run}`;
const noSuch = `ZzNoSuch${run}`;
const jose = `José${run}`;
const obrien = `O'Brien${run}`;
const maryAnn = `Mary Ann${run}`;

const id: Record<string, number> = {};
let token = '';
let api: APIRequestContext;

/** Readable names for the bookings created in beforeAll, used in the report. */
const label: Record<string, string> = {
  main: 'main booking (checkin 2030-01-10, checkout 2030-02-10)',
  fnOnly: 'firstname-only booking (checkin 2030-01-09, checkout 2030-02-09)',
  lnOnly: 'lastname-only booking (checkin 2030-01-11, checkout 2030-02-11)',
  jose: 'José booking',
  obrien: "O'Brien booking",
  maryAnn: 'Mary Ann booking',
  leap: 'leap-day booking (checkin 2028-02-29)',
};

/** e.g. "HTTP 200" */
const st = (res: APIResponse) => `HTTP ${res.status()}`;

/** Describes which of our test bookings came back in a response, e.g. "main booking returned; lastname-only booking NOT returned". */
function which(found: number[] | null, keys: string[]): string {
  if (!found) return 'body was not a JSON array';
  return keys.map((k) => `${label[k]} ${found.includes(id[k]) ? 'returned' : 'NOT returned'}`).join('; ');
}

/** Describes a list of IDs, e.g. "3 IDs returned" or "0 IDs returned (empty list)". */
function count(found: number[] | null): string {
  if (!found) return 'body was not a JSON array';
  return found.length === 0 ? '0 IDs returned (empty list)' : `${found.length} IDs returned`;
}

test.describe('Booking - GetBookingIds', () => {
  test.beforeAll(async ({ playwright }, testInfo) => {
    api = await playwright.request.newContext({
      baseURL: testInfo.project.use.baseURL,
      extraHTTPHeaders: { Accept: 'application/json' },
    });

    const ping = await api.get('/ping');
    expect(ping.status(), 'Health check GET /ping').toBe(201);

    token = await getToken(api);

    // Dates either side of the filter boundaries (checkin 2030-01-10, checkout 2030-02-10)
    id.main = await createBooking(api, { firstname: fn, lastname: ln, checkin: '2030-01-10', checkout: '2030-02-10' });
    id.fnOnly = await createBooking(api, { firstname: fn, lastname: other, checkin: '2030-01-09', checkout: '2030-02-09' });
    id.lnOnly = await createBooking(api, { firstname: other, lastname: ln, checkin: '2030-01-11', checkout: '2030-02-11' });
    id.jose = await createBooking(api, { firstname: jose, lastname: ln, checkin: '2030-01-10', checkout: '2030-02-10' });
    id.obrien = await createBooking(api, { firstname: obrien, lastname: ln, checkin: '2030-01-10', checkout: '2030-02-10' });
    id.maryAnn = await createBooking(api, { firstname: maryAnn, lastname: ln, checkin: '2030-01-10', checkout: '2030-02-10' });
    id.leap = await createBooking(api, { firstname: `Leap${run}`, lastname: ln, checkin: '2028-02-29', checkout: '2028-03-01' });
  });

  test.afterAll(async () => {
    for (const bookingId of Object.values(id)) {
      await deleteBooking(api, bookingId, token);
    }
    await api.dispose();
  });

  // ---------------------------------------------------------------- Core
  test.describe('Core', () => {
    test('TC-01 Retrieve all booking IDs with no filters', async ({ request }) => {
      expected('HTTP 200 with a non-empty JSON array of booking IDs');
      const res = await request.get('/booking');
      const all = await ids(res);
      actual(`${st(res)}, ${count(all)}`);
      expect(res.status()).toBe(200);
      expect(Array.isArray(all)).toBe(true);
      expect(all!.length).toBeGreaterThan(0);
    });

    test('TC-02 Response headers are correct', async ({ request }) => {
      expected('HTTP 200 with Content-Type containing application/json');
      const res = await request.get('/booking');
      actual(`${st(res)}, Content-Type: ${res.headers()['content-type'] ?? '(none)'}`);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toContain('application/json');
    });

    test('TC-03 Response body matches documented schema', async ({ request }) => {
      expected('JSON array where every item is exactly { bookingid: <positive integer> }');
      const res = await request.get('/booking');
      const body = await res.json();
      const bad = Array.isArray(body)
        ? body.filter((i: any) => Object.keys(i).join() !== 'bookingid' || !Number.isInteger(i.bookingid) || i.bookingid <= 0)
        : [];
      actual(Array.isArray(body) ? `${body.length} items, ${bad.length} not matching the schema${bad.length ? `, first: ${JSON.stringify(bad[0])}` : ''}` : `body is not an array: ${typeof body}`);
      expect(Array.isArray(body)).toBe(true);
      for (const item of body) {
        expect(Object.keys(item)).toEqual(['bookingid']);
        expect(Number.isInteger(item.bookingid)).toBe(true);
        expect(item.bookingid).toBeGreaterThan(0);
      }
    });

    test('TC-04 Booking IDs are unique', async ({ request }) => {
      expected('No duplicate booking IDs in the list');
      const all = (await ids(await request.get('/booking')))!;
      const unique = new Set(all).size;
      actual(`${all.length} IDs, ${unique} unique, ${all.length - unique} duplicates`);
      expect(unique).toBe(all.length);
    });

    test('TC-05 Newly created booking appears in list', async ({ request }) => {
      expected(`HTTP 200 and the list includes the ${label.main} (ID ${id.main})`);
      const res = await request.get('/booking');
      const found = await ids(res);
      actual(`${st(res)}, ${which(found, ['main'])}`);
      expect(res.status()).toBe(200);
      expect(found).toContain(id.main);
    });

    test('TC-06 Deleted booking no longer appears', async ({ request }) => {
      expected('DELETE returns 201, then GET /booking returns 200 without the deleted ID');
      const tempId = await createBooking(request, { firstname: `Del${run}`, lastname: 'Del', checkin: '2030-01-01', checkout: '2030-01-02' });
      const delStatus = await deleteBooking(request, tempId, token);
      const res = await request.get('/booking');
      const found = await ids(res);
      actual(`DELETE HTTP ${delStatus}, GET ${st(res)}, deleted ID ${tempId} ${found?.includes(tempId) ? 'still returned' : 'not returned'}`);
      expect(delStatus).toBe(201);
      expect(res.status()).toBe(200);
      expect(found).not.toContain(tempId);
    });

    test('TC-07 Endpoint needs no authentication', async ({ playwright, baseURL, apiLog }) => {
      expected('HTTP 200 with no cookies or auth headers');
      const anon = withLogging(await playwright.request.newContext({ baseURL }), apiLog); // no cookies, no auth headers
      const res = await anon.get('/booking');
      actual(st(res));
      expect(res.status()).toBe(200);
      await anon.dispose();
    });

    test('TC-08 Repeated calls return consistent results', async ({ request }) => {
      test.info().annotations.push({ type: 'note', description: 'May flake if others write to the shared demo API between calls' });
      expected('Two back-to-back calls return the same set of IDs');
      const first = (await ids(await request.get('/booking')))!.sort((a, b) => a - b);
      const second = (await ids(await request.get('/booking')))!.sort((a, b) => a - b);
      const added = second.filter((x) => !first.includes(x)).length;
      const removed = first.filter((x) => !second.includes(x)).length;
      actual(`First call ${first.length} IDs, second call ${second.length} IDs (${added} added, ${removed} removed)`);
      expect(second).toEqual(first);
    });
  });

  // ---------------------------------------------------------------- Name filter
  test.describe('Name filter', () => {
    test('TC-09 Filter by firstname - exact match', async ({ request }) => {
      expected(`HTTP 200; ${label.main} and ${label.fnOnly} returned; ${label.lnOnly} NOT returned`);
      const res = await request.get('/booking', { params: { firstname: fn } });
      const found = await ids(res);
      actual(`${st(res)}, ${which(found, ['main', 'fnOnly', 'lnOnly'])}`);
      expect(res.status()).toBe(200);
      expect(found).toEqual(expect.arrayContaining([id.main, id.fnOnly]));
      expect(found).not.toContain(id.lnOnly);
    });

    test('TC-10 Filter by lastname - exact match', async ({ request }) => {
      expected(`HTTP 200; ${label.main} and ${label.lnOnly} returned; ${label.fnOnly} NOT returned`);
      const res = await request.get('/booking', { params: { lastname: ln } });
      const found = await ids(res);
      actual(`${st(res)}, ${which(found, ['main', 'lnOnly', 'fnOnly'])}`);
      expect(res.status()).toBe(200);
      expect(found).toEqual(expect.arrayContaining([id.main, id.lnOnly]));
      expect(found).not.toContain(id.fnOnly);
    });

    test('TC-11 firstname + lastname combined (AND logic)', async ({ request }) => {
      expected(`HTTP 200; only the ${label.main} (ID ${id.main}) returned`);
      const res = await request.get('/booking', { params: { firstname: fn, lastname: ln } });
      const found = await ids(res);
      actual(`${st(res)}, IDs returned: ${JSON.stringify(found)}`);
      expect(res.status()).toBe(200);
      expect(found).toEqual([id.main]);
    });

    test('TC-12 firstname matches but lastname does not', async ({ request }) => {
      expected('HTTP 200 with an empty list');
      const res = await request.get('/booking', { params: { firstname: fn, lastname: noSuch } });
      const found = await ids(res);
      actual(`${st(res)}, ${count(found)}`);
      expect(res.status()).toBe(200);
      expect(found).toEqual([]);
    });

    test('TC-13 No booking matches name', async ({ request }) => {
      expected('HTTP 200 (not 404) with an empty list');
      const res = await request.get('/booking', { params: { firstname: noSuch } });
      const found = await ids(res);
      actual(`${st(res)}, ${count(found)}`);
      expect(res.status(), 'should be 200, not 404').toBe(200);
      expect(found).toEqual([]);
    });

    test('TC-14 Case sensitivity of name match (INFO)', async ({ request }) => {
      expected('HTTP 200 (whether lowercase matches is not defined by the spec – recorded for the BA)');
      const res = await request.get('/booking', { params: { firstname: fn.toLowerCase() } });
      const matched = ((await ids(res)) ?? []).includes(id.main);
      actual(`${st(res)}, lowercase firstname ${matched ? 'matched' : 'did not match'} the ${label.main}`);
      expect(res.status()).toBe(200);
    });

    test('TC-15 Partial name does not match', async ({ request }) => {
      expected(`HTTP 200; ${label.main} NOT returned for a partial firstname`);
      const res = await request.get('/booking', { params: { firstname: fn.slice(0, -1) } });
      const found = await ids(res);
      actual(`${st(res)}, ${which(found, ['main'])}`);
      expect(res.status()).toBe(200);
      expect(found).not.toContain(id.main);
    });

    for (const [desc, name, key] of [
      ['accented (José)', jose, 'jose'],
      ["apostrophe (O'Brien)", obrien, 'obrien'],
      ['space (Mary Ann)', maryAnn, 'maryAnn'],
    ] as const) {
      test(`TC-16 Special characters - ${desc}`, async ({ request }) => {
        expected(`HTTP 200 and the ${label[key]} returned`);
        const res = await request.get('/booking', { params: { firstname: name } });
        const found = await ids(res);
        actual(`${st(res)}, ${which(found, [key])}`);
        expectNoServerError(res);
        expect(res.status()).toBe(200);
        expect(found).toContain(id[key]);
      });
    }

    test('TC-17 Empty parameter value', async ({ request }) => {
      expected('HTTP 200 with a JSON array (no server error)');
      const res = await request.get('/booking?firstname=');
      const found = await ids(res);
      actual(`${st(res)}, ${count(found)}`);
      expectNoServerError(res);
      expect(res.status()).toBe(200);
      expect(Array.isArray(found)).toBe(true);
    });

    test('TC-18 Very long parameter value', async ({ request }) => {
      expected('HTTP 200 with an empty list, or HTTP 400 / 414 (no server error)');
      const res = await request.get('/booking', { params: { firstname: 'A'.repeat(1200) } });
      const found = res.status() === 200 ? await ids(res) : null;
      actual(res.status() === 200 ? `${st(res)}, ${count(found)}` : st(res));
      expectNoServerError(res);
      expect([200, 400, 414]).toContain(res.status());
      if (res.status() === 200) expect(found).toEqual([]);
    });

    test('TC-19 Leading / trailing whitespace (INFO)', async ({ request }) => {
      expected('HTTP 200 (whether padded names match is not defined by the spec – recorded for the BA)');
      const res = await request.get('/booking', { params: { firstname: ` ${fn} ` } });
      const matched = ((await ids(res)) ?? []).includes(id.main);
      actual(`${st(res)}, padded firstname ${matched ? 'matched' : 'did not match'} the ${label.main}`);
      expectNoServerError(res);
      expect(res.status()).toBe(200);
    });
  });

  // ---------------------------------------------------------------- Date filter
  test.describe('Date filter', () => {
    test('TC-20 Filter by checkin', async ({ request }) => {
      expected(`HTTP 200; checkin=2030-01-10 returns the ${label.lnOnly}`);
      const res = await request.get('/booking', { params: { checkin: '2030-01-10' } });
      const found = await ids(res);
      actual(`${st(res)}, ${which(found, ['lnOnly'])}`);
      expect(res.status()).toBe(200);
      expect(found).toContain(id.lnOnly); // checkin 2030-01-11
    });

    test('TC-21 checkin boundary - same date included', async ({ request }) => {
      expected(`checkin=2030-01-10 returns the ${label.main} (same date is included, >=)`);
      const res = await request.get('/booking', { params: { checkin: '2030-01-10' } });
      const found = await ids(res);
      actual(`${st(res)}, ${which(found, ['main'])}`);
      expect(found, 'checkin = filter date must be included (>=)').toContain(id.main);
    });

    test('TC-22 checkin boundary - day before excluded', async ({ request }) => {
      expected(`checkin=2030-01-10 does NOT return the ${label.fnOnly}`);
      const res = await request.get('/booking', { params: { checkin: '2030-01-10' } });
      const found = await ids(res);
      actual(`${st(res)}, ${which(found, ['fnOnly'])}`);
      expect(found).not.toContain(id.fnOnly); // checkin 2030-01-09
    });

    test('TC-23 Filter by checkout', async ({ request }) => {
      expected(`HTTP 200; checkout=2030-02-10 returns the ${label.lnOnly}`);
      const res = await request.get('/booking', { params: { checkout: '2030-02-10' } });
      const found = await ids(res);
      actual(`${st(res)}, ${which(found, ['lnOnly'])}`);
      expect(res.status()).toBe(200);
      expect(found).toContain(id.lnOnly); // checkout 2030-02-11
    });

    test('TC-24 checkout boundary - same date included', async ({ request }) => {
      expected(`checkout=2030-02-10 returns the ${label.main} (same date is included, >=)`);
      const res = await request.get('/booking', { params: { checkout: '2030-02-10' } });
      const found = await ids(res);
      actual(`${st(res)}, ${which(found, ['main'])}`);
      expect(found, 'checkout = filter date must be included (>=)').toContain(id.main);
    });

    test('TC-25 checkout boundary - day before excluded', async ({ request }) => {
      expected(`checkout=2030-02-10 does NOT return the ${label.fnOnly}`);
      const res = await request.get('/booking', { params: { checkout: '2030-02-10' } });
      const found = await ids(res);
      actual(`${st(res)}, ${which(found, ['fnOnly'])}`);
      expect(found).not.toContain(id.fnOnly); // checkout 2030-02-09
    });

    test('TC-26 checkin + checkout combined', async ({ request }) => {
      expected(`HTTP 200; ${label.main} and ${label.lnOnly} returned; ${label.fnOnly} NOT returned`);
      const res = await request.get('/booking', { params: { checkin: '2030-01-10', checkout: '2030-02-10' } });
      const found = await ids(res);
      actual(`${st(res)}, ${which(found, ['main', 'lnOnly', 'fnOnly'])}`);
      expect(res.status()).toBe(200);
      expect(found).toEqual(expect.arrayContaining([id.main, id.lnOnly]));
      expect(found).not.toContain(id.fnOnly);
    });

    test('TC-27 Leap day is a valid date', async ({ request }) => {
      expected(`HTTP 200; checkin=2028-02-29 returns the ${label.leap}`);
      const res = await request.get('/booking', { params: { checkin: '2028-02-29' } });
      const found = await ids(res);
      actual(`${st(res)}, ${which(found, ['leap'])}`);
      expect(res.status()).toBe(200);
      expect(found).toContain(id.leap);
    });

    test('TC-28 No booking qualifies', async ({ request }) => {
      expected('HTTP 200; checkin=2099-12-31 returns none of our 2028/2030 bookings');
      const res = await request.get('/booking', { params: { checkin: '2099-12-31' } });
      const found = (await ids(res))!;
      actual(`${st(res)}, ${which(found, ['main', 'lnOnly', 'leap'])}`);
      expect(res.status()).toBe(200);
      for (const ours of [id.main, id.lnOnly, id.leap]) expect(found).not.toContain(ours);
    });

    for (const [name, params] of [
      ['TC-29 Wrong date format (DD-MM-YYYY)', { checkin: '10-01-2030' }],
      ['TC-30 Impossible calendar date', { checkin: '2030-02-30' }],
      ['TC-31 Non-date string', { checkout: 'abc' }],
      ['TC-32 Other ISO formats - datetime', { checkin: '2030-01-10T00:00:00Z' }],
      ['TC-32 Other ISO formats - compact', { checkin: '20300110' }],
    ] as const) {
      test(name, async ({ request }) => {
        expected(`HTTP 400 Bad Request for ${JSON.stringify(params)} (format must be CCYY-MM-DD)`);
        const res = await request.get('/booking', { params });
        actual(st(res));
        expectNoServerError(res);
        expect(res.status(), 'format must be CCYY-MM-DD → 400 Bad Request').toBe(400);
      });
    }
  });

  // ---------------------------------------------------------------- Combined / parameters
  test.describe('Combined and parameters', () => {
    test('TC-33 Name and date filters together', async ({ request }) => {
      expected(`HTTP 200; only the ${label.main} (ID ${id.main}) returned`);
      const res = await request.get('/booking', { params: { firstname: fn, checkin: '2030-01-10' } });
      const found = await ids(res);
      actual(`${st(res)}, IDs returned: ${JSON.stringify(found)}`);
      expect(res.status()).toBe(200);
      expect(found).toEqual([id.main]);
    });

    test('TC-34 Unknown parameter is ignored', async ({ request }) => {
      expected('HTTP 200; unknown parameter ignored, so all our bookings are returned');
      const res = await request.get('/booking', { params: { foo: 'bar' } });
      const found = await ids(res);
      actual(`${st(res)}, ${which(found, ['main', 'fnOnly', 'lnOnly'])}`);
      expect(res.status()).toBe(200);
      expect(found).toEqual(expect.arrayContaining([id.main, id.fnOnly, id.lnOnly]));
    });

    test('TC-35 Parameter name case (INFO)', async ({ request }) => {
      expected('HTTP 200 (whether "FirstName" is treated as "firstname" is not defined – recorded for the BA)');
      const res = await request.get('/booking', { params: { FirstName: fn } });
      const filtered = !((await ids(res)) ?? []).includes(id.lnOnly);
      actual(`${st(res)}, FirstName ${filtered ? 'was' : 'was NOT'} applied as a filter`);
      expectNoServerError(res);
      expect(res.status()).toBe(200);
    });

    test('TC-36 Duplicate parameter', async ({ request }) => {
      expected('HTTP 200 or 400 (no server error)');
      const res = await request.get(`/booking?firstname=${encodeURIComponent(fn)}&firstname=${encodeURIComponent(other)}`);
      actual(st(res));
      expectNoServerError(res);
      expect([200, 400]).toContain(res.status());
    });
  });

  // ---------------------------------------------------------------- Security
  test.describe('Security', () => {
    test('TC-37 SQL injection in name filter', async ({ request }) => {
      expected('HTTP 200 with an empty list and no SQL/database error text in the body');
      const res = await request.get('/booking', { params: { firstname: "' OR '1'='1" } });
      const found = await ids(res);
      const text = (await res.text()).toLowerCase();
      const leak = text.match(/sql|syntax|mongo|exception/)?.[0];
      actual(`${st(res)}, ${count(found)}, ${leak ? `error text found: "${leak}"` : 'no error text in body'}`);
      expectNoServerError(res);
      expect(res.status()).toBe(200);
      expect(found).toEqual([]);
      expect(text).not.toMatch(/sql|syntax|mongo|exception/);
    });

    test('TC-38 NoSQL operator injection', async ({ request }) => {
      expected(`HTTP 200 or 400; if 200, the ${label.main} must NOT be returned (filter not bypassed)`);
      const res = await request.get('/booking?firstname[$ne]=x');
      const found = res.status() === 200 ? await ids(res) : null;
      actual(res.status() === 200 ? `${st(res)}, ${which(found, ['main'])}` : st(res));
      expectNoServerError(res);
      expect([200, 400]).toContain(res.status());
      if (res.status() === 200) expect(found, 'must not return all bookings').not.toContain(id.main);
    });

    test('TC-39 Script injection in name', async ({ request }) => {
      expected('HTTP 200 with an empty list and the <script> tag not echoed back');
      const res = await request.get('/booking', { params: { firstname: '<script>alert(1)</script>' } });
      const found = await ids(res);
      const text = await res.text();
      actual(`${st(res)}, ${count(found)}, <script> ${text.includes('<script>') ? 'echoed in body' : 'not in body'}`);
      expectNoServerError(res);
      expect(res.status()).toBe(200);
      expect(found).toEqual([]);
      expect(text).not.toContain('<script>');
    });
  });

  // ---------------------------------------------------------------- HTTP
  test.describe('HTTP', () => {
    test('TC-40 Unsupported method PUT on collection', async ({ request }) => {
      expected('HTTP 404 or 405');
      const res = await request.put('/booking', { data: {} });
      actual(st(res));
      expect([404, 405]).toContain(res.status());
    });

    test('TC-40 Unsupported method PATCH on collection', async ({ request }) => {
      expected('HTTP 404 or 405');
      const res = await request.patch('/booking', { data: {} });
      actual(st(res));
      expect([404, 405]).toContain(res.status());
    });

    test('TC-41 Accept header application/xml', async ({ request }) => {
      expected('HTTP 200 or 406 (no server error)');
      const res = await request.get('/booking', { headers: { Accept: 'application/xml' } });
      actual(`${st(res)}, Content-Type: ${res.headers()['content-type'] ?? '(none)'}`);
      expectNoServerError(res);
      expect([200, 406]).toContain(res.status());
    });

    test('TC-42 Non-TLS access', async ({ request, baseURL }) => {
      expected('Plain HTTP is redirected to HTTPS (301/302/307/308) or refused (403)');
      const httpUrl = `${baseURL!.replace(/^https:/, 'http:')}/booking`;
      const res = await request.get(httpUrl, { maxRedirects: 0 });
      actual(`${st(res)}${res.headers()['location'] ? `, Location: ${res.headers()['location']}` : ''}`);
      expect([301, 302, 307, 308, 403]).toContain(res.status());
    });
  });

  // ---------------------------------------------------------------- Performance
  test.describe('Performance', () => {
    const SLA_MS = Number(process.env.SLA_MS ?? 2000);

    test('TC-43 Response time', async ({ request }) => {
      expected(`10 calls, each HTTP 200 and under ${SLA_MS} ms`);
      const results: { status: number; ms: number }[] = [];
      for (let i = 0; i < 10; i++) {
        const start = Date.now();
        const res = await request.get('/booking');
        results.push({ status: res.status(), ms: Date.now() - start });
      }
      const times = results.map((r) => r.ms);
      const statuses = [...new Set(results.map((r) => r.status))].join(', ');
      actual(`Statuses: ${statuses}; min ${Math.min(...times)} ms, max ${Math.max(...times)} ms, avg ${Math.round(times.reduce((a, b) => a + b, 0) / times.length)} ms`);
      results.forEach((r, i) => {
        expect(r.status).toBe(200);
        expect(r.ms, `call ${i + 1} took ${r.ms} ms`).toBeLessThan(SLA_MS);
      });
    });

    test('TC-44 Full list - no truncation', async ({ request }) => {
      expected(`All ${Object.keys(id).length} of our test bookings returned, in under ${SLA_MS} ms`);
      const start = Date.now();
      const res = await request.get('/booking');
      const elapsed = Date.now() - start;
      const found = await ids(res);
      const missing = Object.keys(id).filter((k) => !found?.includes(id[k]));
      actual(`${st(res)}, ${count(found)}, ${missing.length ? `missing: ${missing.map((k) => label[k]).join('; ')}` : 'all our bookings returned'}, took ${elapsed} ms`);
      expect(found).toEqual(expect.arrayContaining(Object.values(id)));
      expect(elapsed).toBeLessThan(SLA_MS);
    });
  });
});
