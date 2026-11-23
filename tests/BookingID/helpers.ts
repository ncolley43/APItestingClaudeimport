import { APIRequestContext, APIResponse, expect, test } from '@playwright/test';

/** Adds an "Expected" entry to the test's results in the HTML report. Call at the start of a test. */
export function expected(text: string) {
  test.info().annotations.push({ type: 'Expected', description: text });
}

/** Adds an "Actual" entry to the test's results. Call BEFORE the assertions so it is recorded even when the test fails. */
export function actual(text: string) {
  test.info().annotations.push({ type: 'Actual', description: text });
}

export interface BookingData {
  firstname: string;
  lastname: string;
  checkin: string;
  checkout: string;
}

export async function getToken(request: APIRequestContext): Promise<string> {
  const res = await request.post('/auth', {
    data: {
      username: process.env.RB_USER ?? 'admin',
      password: process.env.RB_PASSWORD ?? 'password123',
    },
  });
  expect(res.status(), 'POST /auth').toBe(200);
  return (await res.json()).token;
}

export async function createBooking(request: APIRequestContext, b: BookingData): Promise<number> {
  const res = await request.post('/booking', {
    data: {
      firstname: b.firstname,
      lastname: b.lastname,
      totalprice: 100,
      depositpaid: true,
      bookingdates: { checkin: b.checkin, checkout: b.checkout },
      additionalneeds: 'Breakfast',
    },
  });
  expect(res.status(), `POST /booking for ${b.firstname} ${b.lastname}`).toBe(200);
  return (await res.json()).bookingid;
}

export async function deleteBooking(request: APIRequestContext, id: number, token: string): Promise<number> {
  const res = await request.delete(`/booking/${id}`, { headers: { Cookie: `token=${token}` } });
  return res.status();
}

/** Returns the booking IDs from a GetBookingIds response, or null if the body is not an array. */
export async function ids(res: APIResponse): Promise<number[] | null> {
  try {
    const body = await res.json();
    return Array.isArray(body) ? body.map((x: { bookingid: number }) => x.bookingid) : null;
  } catch {
    return null;
  }
}

export function expectNoServerError(res: APIResponse) {
  expect(res.status(), 'should not be a 5xx server error').toBeLessThan(500);
}
