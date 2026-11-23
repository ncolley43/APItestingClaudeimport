# Booking - GetBookingIds – Playwright API tests

Playwright API suite for restful-booker `GET /booking`. Test titles start with the IDs from the test case sheet (TC-01 to TC-44).

## Setup

```bash
npm install
```

API tests don't need browsers, so there's no need to run `npx playwright install`.

## Run

```bash
npx playwright test                      # all tests
npx playwright test -g "TC-21"           # one test case
npx playwright test -g "Date filter"     # one group
npx playwright show-report               # HTML report
```

## Optional settings (environment variables)

| Variable      | Default                                  |
|---------------|------------------------------------------|
| `BASE_URL`    | https://restful-booker.herokuapp.com     |
| `RB_USER`     | admin                                    |
| `RB_PASSWORD` | password123                              |
| `SLA_MS`      | 2000                                     |

## How it works

- `beforeAll` checks `/ping`, gets a token, and creates bookings with names unique to the run. Their dates fall either side of the filter boundaries (2030-01-10 / 2030-02-10). `afterAll` deletes them.
- Tests marked **INFO** check behaviour the spec doesn't define. They record what happened as an annotation in the report instead of failing.
- restful-booker has bugs on purpose, so some failures are expected. The boundary-date and invalid-date cases are the most likely to fail.
