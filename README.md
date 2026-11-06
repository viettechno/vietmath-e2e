# vietmath-e2e

Browser end-to-end tests for VietMath: the real web apps (student web and admin web), API, database and email,
tested together as a user sees them. Written in **TypeScript** with
**[Playwright](https://playwright.dev)**.

The scenarios are described step by step in
[`vietmath-docs/08_E2E_Test_Scenarios.md`](https://github.com/viettechno/vietmath-docs/blob/master/08_E2E_Test_Scenarios.md).
Each test's title starts with its scenario ID (e.g. `E2E-RW-04`), so a failing test
points to the manual steps it automates.

| What is tested where                                      | Repository                                  |
| --------------------------------------------------------- | ------------------------------------------- |
| Browser end-to-end, web + API together                    | **here**                                    |
| API end-to-end (Go, real server + PostgreSQL, no browser) | `vietmath-backend/cmd/server/*_e2e_test.go` |
| Blackbox: business workflows through the public API       | `vietmath-backend/testing/blackbox`         |
| Unit and component tests                                  | `vietmath-backend`, `vietmath-web`          |

## What is automated

Wave 1, the **smoke suite** (tag `@smoke`, 34 tests, under a minute with 4 workers). It
covers every Release Phase 1, 2 and 3 acceptance criterion through the browser:

| Spec                          | Scenarios                                                       |
| ----------------------------- | --------------------------------------------------------------- |
| `tests/system.spec.ts`        | SYS-01, SYS-02                                                  |
| `tests/i18n.spec.ts`          | I18N-01                                                         |
| `tests/auth/register.spec.ts` | REG-01                                                          |
| `tests/auth/login.spec.ts`    | LOGIN-01, LOGIN-02 (each staff role), LOGIN-02a, LOGIN-03       |
| `tests/auth/sessions.spec.ts` | SESS-01, SESS-02                                                |
| `tests/auth/password.spec.ts` | PWD-01                                                          |
| `tests/browse.spec.ts`        | BRW-01                                                          |
| `tests/users.spec.ts`         | USR-01, USR-05                                                  |
| `tests/catalog.spec.ts`       | CAT-01, CAT-04                                                  |
| `tests/questions.spec.ts`     | QB-01 (text-only × 4, image-only × 2, mixed × 6 choices), QB-06 |
| `tests/review.spec.ts`        | RW-01, RW-03, RW-04, RW-07                                      |
| `tests/access.spec.ts`        | ACL-01 (each role)                                              |
| `tests/templates.spec.ts`     | PAR-01, PAR-02, PAR-03, PAR-04 (templates)                      |

Wave 2, the **regression** specs (no tag; the weekly run does them): the parts that only the
browser can show.

| Spec                           | Scenarios                                                    |
| ------------------------------ | ------------------------------------------------------------ |
| `tests/navigation.spec.ts`     | LOGIN-04, LOGIN-06, BRW-03, SYS-03 (on a phone)              |
| `tests/language.spec.ts`       | I18N-02, I18N-03 (the language of the UI and of the e-mails) |
| `tests/admin-language.spec.ts` | I18N-04 (every admin web page, in Vietnamese and in English) |
| `tests/authoring.spec.ts`      | QB-03, QB-09 (math), QB-10 (drag and paste), PAR-08, RW-02   |

**What the API tests cover instead.** The workflows behind the screens (registration and its
rules, sessions, passwords, Google on the phone, staff accounts and roles, the catalog,
question validation, the review workflow with who may do what, the content-gap counts and
templates) are checked through the API by the blackbox suite of `vietmath-backend`, which is
faster and steadier; a browser spec only needs the UI part of them. Google sign-in in the
browser (GGL-04, PWD-04) needs the real Google and stays manual. Wave 3 (slow, real code
expiry) runs in the blackbox suite with `BLACKBOX_SLOW=1`. The scenarios document maps every
scenario to the suite that runs it (§15.3a).

## Run the tests on your computer

You need Docker, Node.js 22, and read access to the app images in the GitHub
Container Registry (`docker login ghcr.io` with a token that has `read:packages`).

```bash
npm ci
npx playwright install chromium        # once

# Start the whole app (student web http://localhost:8080, admin web http://localhost:8081)
# and Mailpit (http://localhost:8025), and create the first System Admin.
# Pick the app versions with image tags:
BACKEND_TAG=latest WEB_TAG=latest ADMIN_WEB_TAG=latest scripts/stack-up.sh

npm test                               # everything
npm run test:smoke                     # only @smoke
npx playwright test tests/review.spec.ts --headed   # one file, watching the browser
npx playwright test -g E2E-RW-04       # one scenario
npm run report                         # the HTML report of the last run

scripts/stack-down.sh                  # stop the app and delete its data
```

The tests can run many times against the same stack: every account, topic and
question they create has a unique name.

Useful while debugging:

- `docker compose -f stack/docker-compose.yml logs api`: the API log.
- http://localhost:8025: Mailpit, every email the app sent.
- `npx playwright show-trace test-results/<test>/trace.zip`: a failed test step by step,
  with screenshots, DOM snapshots and network calls.
- `npx playwright test --ui`: the interactive test runner.

### Settings

| Variable                                        | Default                                               | Meaning                                                                                               |
| ----------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `BACKEND_TAG`, `WEB_TAG`, `ADMIN_WEB_TAG`       | `latest`                                              | GHCR image tags of `vietmath-backend` / `vietmath-web` / `vietmath-admin-web` (`scripts/stack-up.sh`) |
| `BACKEND_IMAGE`, `WEB_IMAGE`, `ADMIN_WEB_IMAGE` | `ghcr.io/viettechno/vietmath-{backend,web,admin-web}` | Other images, e.g. ones built locally (with `E2E_SKIP_PULL=1`)                                        |
| `E2E_BASE_URL`                                  | `http://localhost:8080`                               | The student web under test (web and `/api` on one origin)                                             |
| `E2E_ADMIN_URL`                                 | `http://localhost:8081`                               | The admin web under test (staff pages; `/api` on the same origin)                                     |
| `E2E_MAILPIT_URL`                               | `http://localhost:8025`                               | Mailpit, to read email codes. Empty: tests that need a code are skipped                               |
| `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`         | `admin@vietmath.test`, `E2eAdmin123`                  | An existing System Admin                                                                              |
| `E2E_MAIL_DOMAIN`                               | `vietmath.test`                                       | Domain of the email addresses the tests create                                                        |

### Against staging

Point the tests at the staging VM. Staging sends all its e-mail to a Mailpit (the test
inbox, `vietmath-infra/staging`), so the tests that read codes work too; its login goes in the
URL (`make blackbox-env` in `vietmath-infra/staging` prints it). The **E2E (staging)**
workflow does this from GitHub Actions:

```bash
E2E_BASE_URL=https://vietmath-staging.viettechno.com E2E_ADMIN_URL=https://vietmath-admin-staging.viettechno.com \
E2E_MAILPIT_URL=https://blackbox:<password>@vietmath-mailpit-staging.viettechno.com \
E2E_ADMIN_EMAIL=… E2E_ADMIN_PASSWORD=… npx playwright test
```

This leaves test accounts, topics, questions and one exam pack per run on staging.

**Never run the suite against production** (also a single VM in Vietnam, the same stack): it creates accounts, questions and exam packs. After a release, check production by hand with the read-only scenarios `E2E-SYS-01`, `E2E-SYS-02` and `E2E-I18N-01` of the scenarios document.

## Writing tests

- **One scenario, one test**, titled `E2E-<AREA>-<NN> · <scenario name>`, tagged `@smoke`
  when it belongs to the smoke suite.
- **Set up through the API, test through the browser.** The fixtures in
  `support/fixtures.ts` give each test fresh accounts (`accounts.staff(role)`,
  `accounts.customer()`), topics (`newTopic()`), the shared `asmoPack`, and extra
  browsers (`newBrowser()`, e.g. a phone with `devices['Pixel 7']`).
- **Never share an account between tests.** An account can be signed in on one computer
  and one phone only, so a shared account signs other tests out.
- **Find elements like a user does:** by role and visible label
  (`getByRole('button', { name: 'Approve and publish' })`), not by CSS classes. Tests read
  the English labels. `uiLanguage` sets the language a browser starts in.
- **No sleeps.** Use web-first assertions (`await expect(locator).toBeVisible()`), which
  wait. Emails are read with `Inbox` (`support/mailpit.ts`): `mark()` before the action
  that sends one, then `nextCode()`.
- A test that fails and then passes on retry is reported as **flaky**. Fix it, don't
  ignore it.
- Before pushing: `npm run typecheck && npm run format:check`.

### Layout

```
playwright.config.ts   projects, timeouts, reporters
stack/                 the app for the tests: the VM stack (staging and production use it too) + Mailpit
scripts/               stack-up.sh, stack-down.sh
support/
  env.ts               settings from environment variables
  api.ts               REST API client for test set-up
  fixtures.ts          accounts, topics, exam pack, extra browsers
  mailpit.ts           reads email codes
  data.ts              unique emails, phone numbers, names
  pages/               helpers per screen (sign-in, question editor)
tests/                 the specs, by area
assets/                images for the question bank tests
```

## CI

`.github/workflows/e2e.yml` starts the stack from GHCR images and runs the tests:

| Trigger                        | Tests                          | Image tags                                                                                  |
| ------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------- |
| Pull request, push to `master` | `@smoke`                       | repository variables `E2E_BACKEND_TAG` / `E2E_WEB_TAG` / `E2E_ADMIN_WEB_TAG`, else `latest` |
| Weekly (Sunday 08:00 Vietnam)  | everything                     | same                                                                                        |
| Run workflow (manual)          | `grep` input, default `@smoke` | `backend_tag` / `web_tag` / `admin_web_tag` inputs                                          |

The HTML report, traces, videos and the app log are uploaded as the
`playwright-report` artifact.

`.github/workflows/e2e-staging.yml` (**E2E (staging)**) runs the tests against the staging
deployment instead of a stack of its own: on demand (`grep` input, default `@smoke`) and every
Sunday at 08:30 Vietnam time, after the blackbox tests (08:00). It reads the addresses and
logins from the secrets `E2E_STAGING_BASE_URL`, `E2E_STAGING_ADMIN_URL`,
`E2E_STAGING_MAILPIT_URL`, `E2E_STAGING_ADMIN_EMAIL` and `E2E_STAGING_ADMIN_PASSWORD`.

### CI setup (once)

1. **Read access to the images.** The `vietmath-backend`, `vietmath-web` and `vietmath-admin-web` packages are
   private. On GitHub, open each package (organization → Packages → the package →
   Package settings → **Manage Actions access**) and add `vietmath-e2e` with the
   **Read** role. Alternatively, add a `GHCR_TOKEN` secret here: a token with
   `read:packages`.
2. **Which app versions to test.** Until the Release Phase 2 branches are merged, `latest`
   has no Phase 2 features. Set the repository variables (Settings → Secrets and
   variables → Actions → Variables) `E2E_BACKEND_TAG` and `E2E_WEB_TAG` to
   `feat-question-bank`. Delete them after the merge to test `latest`.

### Running from the app repositories (next step)

To gate app pull requests on the smoke suite, the app repositories can start this
workflow for their own image tag. That needs a token with access to this private
repository (a GitHub App or fine-grained token with `actions: write`), stored as a
secret in the app repository:

```yaml
# in vietmath-web or vietmath-backend, after the image is pushed
- run: >
    gh workflow run e2e.yml --repo viettechno/vietmath-e2e
    -f web_tag=sha-${GITHUB_SHA::7}
  env:
    GH_TOKEN: ${{ secrets.E2E_DISPATCH_TOKEN }}
```
