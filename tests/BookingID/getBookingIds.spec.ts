import { test, expect, APIRequestContext } from '@playwright/test';
import { createBooking, deleteBooking, expectNoServerError, getToken, ids } from './helpers';

/**
 * Booking - GetBookingIds (GET /booking)
 * Test IDs match the "GetBookingIds API – Test Cases" sheet (TC-01 .. TC-44).
 *
 * beforeAll creates unique test data for this run so nothing depends on, or clashes with,
 * other people's data on the shared restful-booker demo. afterAll deletes it.
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
      const res = await request.get('/booking');
      expect(res.status()).toBe(200);
      const all = await ids(res);
      expect(Array.isArray(all)).toBe(true);
      expect(all!.length).toBeGreaterThan(0);
    });

    test('TC-02 Response headers are correct', async ({ request }) => {
      const res = await request.get('/booking');
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toContain('application/json');
    });

    test('TC-03 Response body matches documented schema', async ({ request }) => {
      const res = await request.get('/booking');
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      for (const item of body) {
        expect(Object.keys(item)).toEqual(['bookingid']);
        expect(Number.isInteger(item.bookingid)).toBe(true);
        expect(item.bookingid).toBeGreaterThan(0);
      }
    });

    test('TC-04 Booking IDs are unique', async ({ request }) => {
      const all = (await ids(await request.get('/booking')))!;
      expect(new Set(all).size).toBe(all.length);
    });

    test('TC-05 Newly created booking appears in list', async ({ request }) => {
      const res = await request.get('/booking');
      expect(res.status()).toBe(200);
      expect(await ids(res)).toContain(id.main);
    });

    test('TC-06 Deleted booking no longer appears', async ({ request }) => {
      const tempId = await createBooking(request, { firstname: `Del${run}`, lastname: 'Del', checkin: '2030-01-01', checkout: '2030-01-02' });
      expect(await deleteBooking(request, tempId, token)).toBe(201);
      const res = await request.get('/booking');
      expect(res.status()).toBe(200);
      expect(await ids(res)).not.toContain(tempId);
    });

    test('TC-07 Endpoint needs no authentication', async ({ playwright, baseURL }) => {
      const anon = await playwright.request.newContext({ baseURL }); // no cookies, no auth headers
      const res = await anon.get('/booking');
      expect(res.status()).toBe(200);
      await anon.dispose();
    });

    test('TC-08 Repeated calls return consistent results', async ({ request }) => {
      test.info().annotations.push({ type: 'note', description: 'May flake if others write to the shared demo API between calls' });
      const first = (await ids(await request.get('/booking')))!.sort((a, b) => a - b);
      const second = (await ids(await request.get('/booking')))!.sort((a, b) => a - b);
      expect(second).toEqual(first);
    });
  });

  // ---------------------------------------------------------------- Name filter
  test.describe('Name filter', () => {
    test('TC-09 Filter by firstname - exact match', async ({ request }) => {
      const res = await request.get('/booking', { params: { firstname: fn } });
      expect(res.status()).toBe(200);
      const found = await ids(res);
      expect(found).toEqual(expect.arrayContaining([id.main, id.fnOnly]));
      expect(found).not.toContain(id.lnOnly);
    });

    test('TC-10 Filter by lastname - exact match', async ({ request }) => {
      const res = await request.get('/booking', { params: { lastname: ln } });
      expect(res.status()).toBe(200);
      const found = await ids(res);
      expect(found).toEqual(expect.arrayContaining([id.main, id.lnOnly]));
      expect(found).not.toContain(id.fnOnly);
    });

    test('TC-11 firstname + lastname combined (AND logic)', async ({ request }) => {
      const res = await request.get('/booking', { params: { firstname: fn, lastname: ln } });
      expect(res.status()).toBe(200);
      expect(await ids(res)).toEqual([id.main]);
    });

    test('TC-12 firstname matches but lastname does not', async ({ request }) => {
      const res = await request.get('/booking', { params: { firstname: fn, lastname: noSuch } });
      expect(res.status()).toBe(200);
      expect(await ids(res)).toEqual([]);
    });

    test('TC-13 No booking matches name', async ({ request }) => {
      const res = await request.get('/booking', { params: { firstname: noSuch } });
      expect(res.status(), 'should be 200, not 404').toBe(200);
      expect(await ids(res)).toEqual([]);
    });

    test('TC-14 Case sensitivity of name match (INFO)', async ({ request }) => {
      const res = await request.get('/booking', { params: { firstname: fn.toLowerCase() } });
      expect(res.status()).toBe(200);
      const matched = ((await ids(res)) ?? []).includes(id.main);
      test.info().annotations.push({ type: 'INFO', description: `Lowercase firstname matched booking: ${matched} (spec silent – confirm with BA)` });
    });

    test('TC-15 Partial name does not match', async ({ request }) => {
      const res = await request.get('/booking', { params: { firstname: fn.slice(0, -1) } });
      expect(res.status()).toBe(200);
      expect(await ids(res)).not.toContain(id.main);
    });

    for (const [label, name, key] of [
      ['accented (José)', jose, 'jose'],
      ["apostrophe (O'Brien)", obrien, 'obrien'],
      ['space (Mary Ann)', maryAnn, 'maryAnn'],
    ] as const) {
      test(`TC-16 Special characters - ${label}`, async ({ request }) => {
        const res = await request.get('/booking', { params: { firstname: name } });
        expectNoServerError(res);
        expect(res.status()).toBe(200);
        expect(await ids(res)).toContain(id[key]);
      });
    }

    test('TC-17 Empty parameter value', async ({ request }) => {
      const res = await request.get('/booking?firstname=');
      expectNoServerError(res);
      expect(res.status()).toBe(200);
      const found = await ids(res);
      expect(Array.isArray(found)).toBe(true);
      test.info().annotations.push({ type: 'INFO', description: `Empty firstname returned ${found!.length} IDs` });
    });

    test('TC-18 Very long parameter value', async ({ request }) => {
      const res = await request.get('/booking', { params: { firstname: 'A'.repeat(1200) } });
      expectNoServerError(res);
      expect([200, 400, 414]).toContain(res.status());
      if (res.status() === 200) expect(await ids(res)).toEqual([]);
    });

    test('TC-19 Leading / trailing whitespace (INFO)', async ({ request }) => {
      const res = await request.get('/booking', { params: { firstname: ` ${fn} ` } });
      expectNoServerError(res);
      expect(res.status()).toBe(200);
      const matched = ((await ids(res)) ?? []).includes(id.main);
      test.info().annotations.push({ type: 'INFO', description: `Padded firstname matched booking: ${matched}` });
    });
  });

  // ---------------------------------------------------------------- Date filter
  test.describe('Date filter', () => {
    test('TC-20 Filter by checkin', async ({ request }) => {
      const res = await request.get('/booking', { params: { checkin: '2030-01-10' } });
      expect(res.status()).toBe(200);
      expect(await ids(res)).toContain(id.lnOnly); // checkin 2030-01-11
    });

    test('TC-21 checkin boundary - same date included', async ({ request }) => {
      const res = await request.get('/booking', { params: { checkin: '2030-01-10' } });
      expect(await ids(res), 'checkin = filter date must be included (>=)').toContain(id.main);
    });

    test('TC-22 checkin boundary - day before excluded', async ({ request }) => {
      const res = await request.get('/booking', { params: { checkin: '2030-01-10' } });
      expect(await ids(res)).not.toContain(id.fnOnly); // checkin 2030-01-09
    });

    test('TC-23 Filter by checkout', async ({ request }) => {
      const res = await request.get('/booking', { params: { checkout: '2030-02-10' } });
      expect(res.status()).toBe(200);
      expect(await ids(res)).toContain(id.lnOnly); // checkout 2030-02-11
    });

    test('TC-24 checkout boundary - same date included', async ({ request }) => {
      const res = await request.get('/booking', { params: { checkout: '2030-02-10' } });
      expect(await ids(res), 'checkout = filter date must be included (>=)').toContain(id.main);
    });

    test('TC-25 checkout boundary - day before excluded', async ({ request }) => {
      const res = await request.get('/booking', { params: { checkout: '2030-02-10' } });
      expect(await ids(res)).not.toContain(id.fnOnly); // checkout 2030-02-09
    });

    test('TC-26 checkin + checkout combined', async ({ request }) => {
      const res = await request.get('/booking', { params: { checkin: '2030-01-10', checkout: '2030-02-10' } });
      expect(res.status()).toBe(200);
      const found = await ids(res);
      expect(found).toEqual(expect.arrayContaining([id.main, id.lnOnly]));
      expect(found).not.toContain(id.fnOnly);
    });

    test('TC-27 Leap day is a valid date', async ({ request }) => {
      const res = await request.get('/booking', { params: { checkin: '2028-02-29' } });
      expect(res.status()).toBe(200);
      expect(await ids(res)).toContain(id.leap);
    });

    test('TC-28 No booking qualifies', async ({ request }) => {
      const res = await request.get('/booking', { params: { checkin: '2099-12-31' } });
      expect(res.status()).toBe(200);
      const found = (await ids(res))!;
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
        const res = await request.get('/booking', { params });
        expectNoServerError(res);
        expect(res.status(), 'format must be CCYY-MM-DD → 400 Bad Request').toBe(400);
      });
    }
  });

  // ---------------------------------------------------------------- Combined / parameters
  test.describe('Combined and parameters', () => {
    test('TC-33 Name and date filters together', async ({ request }) => {
      const res = await request.get('/booking', { params: { firstname: fn, checkin: '2030-01-10' } });
      expect(res.status()).toBe(200);
      expect(await ids(res)).toEqual([id.main]);
    });

    test('TC-34 Unknown parameter is ignored', async ({ request }) => {
      const res = await request.get('/booking', { params: { foo: 'bar' } });
      expect(res.status()).toBe(200);
      expect(await ids(res)).toEqual(expect.arrayContaining([id.main, id.fnOnly, id.lnOnly]));
    });

    test('TC-35 Parameter name case (INFO)', async ({ request }) => {
      const res = await request.get('/booking', { params: { FirstName: fn } });
      expectNoServerError(res);
      expect(res.status()).toBe(200);
      const filtered = !((await ids(res)) ?? []).includes(id.lnOnly);
      test.info().annotations.push({ type: 'INFO', description: `FirstName (wrong case) applied as a filter: ${filtered}` });
    });

    test('TC-36 Duplicate parameter', async ({ request }) => {
      const res = await request.get(`/booking?firstname=${encodeURIComponent(fn)}&firstname=${encodeURIComponent(other)}`);
      expectNoServerError(res);
      expect([200, 400]).toContain(res.status());
    });
  });

  // ---------------------------------------------------------------- Security
  test.describe('Security', () => {
    test('TC-37 SQL injection in name filter', async ({ request }) => {
      const res = await request.get('/booking', { params: { firstname: "' OR '1'='1" } });
      expectNoServerError(res);
      expect(res.status()).toBe(200);
      expect(await ids(res)).toEqual([]);
      expect((await res.text()).toLowerCase()).not.toMatch(/sql|syntax|mongo|exception/);
    });

    test('TC-38 NoSQL operator injection', async ({ request }) => {
      const res = await request.get('/booking?firstname[$ne]=x');
      expectNoServerError(res);
      expect([200, 400]).toContain(res.status());
      if (res.status() === 200) expect(await ids(res), 'must not return all bookings').not.toContain(id.main);
    });

    test('TC-39 Script injection in name', async ({ request }) => {
      const res = await request.get('/booking', { params: { firstname: '<script>alert(1)</script>' } });
      expectNoServerError(res);
      expect(res.status()).toBe(200);
      expect(await ids(res)).toEqual([]);
      expect(await res.text()).not.toContain('<script>');
    });
  });

  // ---------------------------------------------------------------- HTTP
  test.describe('HTTP', () => {
    test('TC-40 Unsupported method PUT on collection', async ({ request }) => {
      const res = await request.put('/booking', { data: {} });
      expect([404, 405]).toContain(res.status());
    });

    test('TC-40 Unsupported method PATCH on collection', async ({ request }) => {
      const res = await request.patch('/booking', { data: {} });
      expect([404, 405]).toContain(res.status());
    });

    test('TC-41 Accept header application/xml', async ({ request }) => {
      const res = await request.get('/booking', { headers: { Accept: 'application/xml' } });
      expectNoServerError(res);
      test.info().annotations.push({ type: 'INFO', description: `Status ${res.status()}, Content-Type ${res.headers()['content-type']}` });
      expect([200, 406]).toContain(res.status());
    });

    test('TC-42 Non-TLS access', async ({ request, baseURL }) => {
      const httpUrl = `${baseURL!.replace(/^https:/, 'http:')}/booking`;
      const res = await request.get(httpUrl, { maxRedirects: 0 });
      expect([301, 302, 307, 308, 403]).toContain(res.status());
    });
  });

  // ---------------------------------------------------------------- Performance
  test.describe('Performance', () => {
    const SLA_MS = Number(process.env.SLA_MS ?? 2000);

    test('TC-43 Response time', async ({ request }) => {
      for (let i = 0; i < 10; i++) {
        const start = Date.now();
        const res = await request.get('/booking');
        const elapsed = Date.now() - start;
        expect(res.status()).toBe(200);
        expect(elapsed, `call ${i + 1} took ${elapsed} ms`).toBeLessThan(SLA_MS);
      }
    });

    test('TC-44 Full list - no truncation', async ({ request }) => {
      const start = Date.now();
      const res = await request.get('/booking');
      const elapsed = Date.now() - start;
      expect(await ids(res)).toEqual(expect.arrayContaining(Object.values(id)));
      expect(elapsed).toBeLessThan(SLA_MS);
    });
  });
});
