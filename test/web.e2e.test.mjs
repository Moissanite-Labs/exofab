// Browser end-to-end test: the first-slice journey through the real web
// client and HTTP API, driven with Playwright when it is installed (it is not
// a dependency of this repository; without it the test skips and says so).
//
// Ada and Ben each use their own browser context, so each has their own
// IndexedDB keyring, as two people on two browser profiles would. Scribe is an
// agent: its key lives in this test process, as an agent runtime's would, and
// it registers (with Ben's session token) and submits through ExofabClient.
// Synthetic people and data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from '../src/server.mjs';
import { ExofabClient } from '../src/client.mjs';
import { FileStore } from '../src/hub/store.mjs';
import { Hub } from '../src/hub/hub.mjs';
import { generateIdentity, sha256Hex, utf8, verifyBundle } from '../src/koinos/index.mjs';
import { NO_ECONOMIC_RIGHT } from '../web/actions.mjs';

const TEXT = 'text/plain; charset=utf-8';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try {
    require.resolve('playwright');
  } catch {
    return null;
  }
  return require('playwright');
}

const BRIEF = {
  title: 'Recipe-scaling skill for Exo (synthetic)',
  summary: 'Synthetic demonstration brief. A small Exo skill that scales home-baking recipes, with tests.',
  compensation: 'None offered. Credit is recorded for accepted work only.',
  role: 'Skill builder',
};
const CONTRIBUTION = 'recipe-scale skill v1 (synthetic)';
const ARTIFACT = `# recipe-scale (synthetic demonstration skill)

Scales the ingredient amounts of a recipe by a factor.

## Tests (synthetic)
- 2 x 250 g flour = 500 g flour: pass
- 0.5 x 3 eggs = 1.5 eggs: pass
`;

// Screenshots go to a temporary directory that is removed afterwards, unless
// EXOFAB_SCREENSHOTS names a directory to keep them in.
async function screenshotDir(t) {
  const kept = process.env.EXOFAB_SCREENSHOTS;
  if (kept) {
    await mkdir(resolve(kept), { recursive: true });
    return resolve(kept);
  }
  const dir = await mkdtemp(join(tmpdir(), 'exofab-web-e2e-shots-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

// --- Page helpers ------------------------------------------------------------------

// Waits until the client has finished drawing `view`.
const settled = (page, view) => page.locator(view ? `main[data-view="${view}"]:not([aria-busy])` : 'main[data-view]:not([aria-busy])').waitFor();

async function go(page, hash, view) {
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
  await settled(page, view);
}

async function reload(page, view) {
  await page.reload();
  await settled(page, view);
}

const status = (page, text) => page.locator('#status', { hasText: text }).waitFor();

// Serves stored bytes with a line appended, as a dishonest or broken hub might.
const BLOBS = '**/api/projects/*/blobs/*';
const tamper = (page) =>
  page.route(BLOBS, async (route) => {
    const response = await route.fetch();
    const body = Buffer.concat([await response.body(), Buffer.from('Payment: 100 tokens.\n')]);
    await route.fulfill({ status: 200, contentType: 'application/octet-stream', body });
  });

// The one open dialog.
const dialog = (page) => page.locator('dialog[open]');

async function signOpenDialog(page) {
  const d = dialog(page);
  await d.getByRole('button', { name: 'Sign with my key' }).click();
  await d.waitFor({ state: 'detached' });
}

async function newPerson(page, url, name) {
  await page.goto(url);
  await settled(page, 'discover');
  await page.locator('#identity-new').click();
  await dialog(page).getByLabel('Name', { exact: true }).fill(name);
  await dialog(page).getByRole('button', { name: 'Create key' }).click();
  await status(page, 'is registered with the hub');
}

async function saveProfile(page, { headline, skills }) {
  await go(page, '#/profile', 'profile');
  await page.getByRole('textbox', { name: 'Headline', exact: true }).fill(headline);
  await page.getByRole('textbox', { name: 'Skills', exact: true }).fill(skills);
  await page.getByLabel('List my profile so other people on this hub can find me', { exact: true }).check();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await status(page, 'Profile saved.');
  await settled(page, 'profile');
}

// --- The journey ----------------------------------------------------------------------

test('web client: two people and an agent complete the first-slice journey in the browser', { timeout: 240_000 }, async (t) => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('playwright is not installed (require("playwright") does not resolve), so the browser journey was not run');
    return;
  }

  const dataDir = await mkdtemp(join(tmpdir(), 'exofab-web-e2e-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const server = await createServer({ hub: new Hub({ store: new FileStore(dataDir) }), port: 0, log: () => {} });
  t.after(() => server.close());
  const browser = await playwright.chromium.launch();
  t.after(() => browser.close());
  const SHOTS = await screenshotDir(t);

  const problems = [];
  const open = async (who) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    page.on('pageerror', (error) => problems.push(`${who}: page error: ${error.message}`));
    page.on('console', (message) => {
      if (/Content.Security.Policy/i.test(message.text())) problems.push(`${who}: ${message.text()}`);
    });
    return page;
  };
  const ada = await open('Ada');
  const ben = await open('Ben');

  try {
    // 1. People: keys generated in each browser, registered by signed challenge.
    await newPerson(ada, server.url, 'Ada');
    await saveProfile(ada, { headline: 'Runs a fictional home-baking community (synthetic person)', skills: 'community, recipes' });
    await newPerson(ben, server.url, 'Ben');
    await saveProfile(ben, { headline: 'Builds Exo skills (synthetic person)', skills: 'exo-skills, testing' });
    for (const page of [ada, ben]) {
      const stored = await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const r = indexedDB.open('exofab-keyring');
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        const all = await new Promise((resolve) => {
          const r = db.transaction('identities').objectStore('identities').getAll();
          r.onsuccess = () => resolve(r.result);
        });
        return all.map((x) => ({ extractable: x.privateKey.extractable, type: x.privateKey.type, registered: typeof x.token === 'string' }));
      });
      assert.deepEqual(stored, [{ extractable: false, type: 'private', registered: true }], 'one non-extractable key per browser, with its token');
    }

    // 2. Ada publishes a brief with a compensation statement and one role.
    await go(ada, '#/discover', 'discover');
    await ada.getByRole('button', { name: 'Publish a brief' }).click();
    const form = dialog(ada);
    await form.getByLabel('Title', { exact: true }).fill(BRIEF.title);
    await form.getByLabel('Summary', { exact: true }).fill(BRIEF.summary);
    await form.getByLabel('Compensation statement', { exact: true }).fill(BRIEF.compensation);
    await form.getByLabel('Role title', { exact: true }).fill(BRIEF.role);
    await form.getByRole('textbox', { name: 'Skills', exact: true }).fill('exo-skills, testing');
    await form.getByLabel('Commitment', { exact: true }).fill('A few evenings');
    await form.getByRole('button', { name: 'Publish brief' }).click();
    await settled(ada, 'brief');
    assert.equal(await ada.locator('main h1').textContent(), BRIEF.title);
    const briefHash = new URL(ada.url()).hash;
    assert.match(briefHash, /^#\/brief\/brf_[0-9a-f]+$/);

    // 3. Ben sees it under "Suggested for you", with the reason.
    await go(ben, '#/discover', 'discover');
    const suggested = ben.locator('section', { has: ben.getByRole('heading', { name: 'Suggested for you' }) });
    await suggested.getByRole('link', { name: BRIEF.title }).waitFor();
    assert.match(await suggested.textContent(), /shared skill: exo-skills/);
    assert.match(await suggested.textContent(), /shared skill: testing/);
    await ben.screenshot({ path: join(SHOTS, 'discover.png'), fullPage: true });

    // 4. Ben expresses interest; Ada reads his profile and accepts (double opt-in).
    await suggested.getByRole('link', { name: BRIEF.title }).click();
    await settled(ben, 'brief');
    await ben.getByRole('button', { name: `Express interest in ${BRIEF.role}` }).click();
    await dialog(ben).getByLabel('Note to the owner', { exact: true }).fill('I build Exo skills and can start this week. (synthetic)');
    await dialog(ben).getByRole('button', { name: 'Send interest' }).click();
    await status(ben, 'Interest sent.');

    await reload(ada, 'brief');
    const inbox = ada.locator('section', { has: ada.getByRole('heading', { name: 'Interests' }) });
    assert.match(await inbox.textContent(), /Builds Exo skills \(synthetic person\)/, 'the owner sees the candidate profile');
    await inbox.getByRole('button', { name: 'Accept Ben' }).click();
    await dialog(ada).getByRole('button', { name: 'Accept', exact: true }).click();
    await status(ada, 'Ben joined the team.');

    // 5. Ben's agent registers from its own runtime (here: this process) with
    //    Ben's session token, then Ben nominates it in the browser.
    await go(ben, '#/profile', 'profile');
    assert.match(await ben.getByLabel('Commands to register an agent and submit its work', { exact: true }).textContent(), new RegExp(`node src/cli\\.mjs agent register --name scribe --key scribe\\.pem --hub ${server.url}`));
    await ben.getByRole('button', { name: 'Show my session token' }).click();
    await dialog(ben).getByRole('button', { name: 'Show token' }).click();
    const benToken = await dialog(ben).getByRole('textbox', { name: 'Session token' }).inputValue();
    assert.match(benToken, /^exf_[A-Za-z0-9_-]{43}$/);
    await dialog(ben).getByRole('button', { name: 'Close' }).click();
    const scribeKey = await generateIdentity();
    const benClient = new ExofabClient({ baseUrl: server.url, token: benToken });
    const { agent, token: scribeToken } = await benClient.registerAgent({ name: 'scribe', identity: scribeKey });
    assert.equal(agent.principal, (await benClient.me()).id);

    await go(ben, briefHash, 'brief');
    await ben.getByRole('button', { name: 'Nominate my agent scribe' }).click();
    await dialog(ben).getByRole('button', { name: 'Nominate', exact: true }).click();
    await status(ben, 'scribe is nominated.');

    // 6. Ada starts the record; the sign dialog shows the exact participant list.
    await reload(ada, 'brief');
    await ada.screenshot({ path: join(SHOTS, 'brief.png'), fullPage: true });
    await ada.getByRole('button', { name: 'Start the record' }).click();
    const genesis = dialog(ada);
    const listed = genesis.getByRole('region', { name: 'Participants this record will list' });
    const rows = await listed.locator('tbody tr').allTextContents();
    assert.equal(rows.length, 3);
    assert.match(rows[0], /^AdaPerson/);
    assert.match(rows[1], /^BenPerson/);
    assert.match(rows[2], /^scribeAgent/);
    assert.ok(rows[2].includes(scribeKey.id));
    assert.match(await genesis.locator('.sign-summary').textContent(), /Ada started the project “Recipe-scaling skill for Exo \(synthetic\)” with Ada, Ben and scribe \(agent\)\./);
    await signOpenDialog(ada);
    await settled(ada, 'project');
    const pid = decodeURIComponent(new URL(ada.url()).hash.replace('#/project/', ''));
    await ada.getByText('Verified in this browser').waitFor();

    // 7. Ada proposes the charter from the template; its text is stored by digest.
    await ada.getByRole('button', { name: 'Propose the charter' }).click();
    const charterText = await dialog(ada).getByLabel('Terms text', { exact: true }).inputValue();
    assert.ok(charterText.includes(NO_ECONOMIC_RIGHT), 'the template carries the no-economic-rights statement');
    await dialog(ada).getByRole('button', { name: 'Store the text and review the record' }).click();
    await dialog(ada).getByText('I have read the exact terms text above.').click();
    await signOpenDialog(ada);
    await status(ada, 'Charter proposed.');
    await settled(ada, 'project');

    // 8. Consent: exact terms text and matching digests, recomputed in the browser.
    //    Ada opens her consent dialog first, but Ben consents before she signs,
    //    so the head moves under her draft: the hub answers 409 and her page
    //    rebuilds the record on the new head and asks her again.
    const readTerms = async (page, who) => {
      const sign = dialog(page);
      const shown = await sign.getByLabel('Exact terms text', { exact: true }).textContent();
      assert.equal(shown, charterText, `${who} sees exactly the stored terms text`);
      const [named, computed] = await sign.locator('.facts-digests dd').allTextContents();
      assert.equal(named, await sha256Hex(charterText), 'the digest in the record is the SHA-256 of the text shown');
      assert.equal(computed, named, 'the digest computed by the browser equals the digest in the record');
      assert.match(await sign.locator('.notice-ok').first().textContent(), /computed by this browser from the stored terms equals the digest in the record/);
      const button = sign.getByRole('button', { name: 'Sign with my key' });
      assert.equal(await button.isDisabled(), true, 'signing waits until the person says they read the terms');
      await sign.getByText('I have read the exact terms text above.').click();
      assert.equal(await button.isDisabled(), false);
      return (await sign.locator('.facts-envelope dd').allTextContents())[2]; // sequence
    };
    const consentButton = (page) => page.getByRole('button', { name: 'Read the terms and consent to “Charter”' });

    await consentButton(ada).click();
    assert.equal(await readTerms(ada, 'Ada'), '2');
    await ada.screenshot({ path: join(SHOTS, 'consent-dialog.png') });

    await go(ben, `#/project/${encodeURIComponent(pid)}`, 'project');
    await tamper(ben);
    await consentButton(ben).click();
    const altered = dialog(ben);
    await altered.getByText('The stored terms do not match the digest in the record.').waitFor();
    assert.equal(await altered.getByRole('button', { name: 'Sign with my key' }).isDisabled(), true, 'altered terms cannot be signed');
    assert.equal(await altered.getByText('I have read the exact terms text above.').count(), 0);
    await altered.getByRole('button', { name: 'Cancel' }).click();
    await ben.unroute(BLOBS);
    await settled(ben, 'project');
    await consentButton(ben).click();
    assert.equal(await readTerms(ben, 'Ben'), '2');
    await signOpenDialog(ben);
    await status(ben, 'You consented to “Charter”.');
    await settled(ben, 'project');

    await dialog(ada).getByRole('button', { name: 'Sign with my key' }).click();
    await status(ada, 'Another record was added while you were reviewing.');
    assert.equal(await readTerms(ada, 'Ada'), '3', 'the rebuilt record follows Ben’s consent');
    await signOpenDialog(ada);
    await status(ada, 'You consented to “Charter”.');
    await settled(ada, 'project');
    await reload(ben, 'project');

    // 9. Ben delegates contribution.submit to his own agent, with an expiry.
    await ben.getByRole('button', { name: 'Delegate to my agent under “Charter”' }).click();
    assert.equal(await dialog(ben).getByLabel('Expires after (days)', { exact: true }).inputValue(), '14');
    await dialog(ben).getByRole('button', { name: 'Review the record' }).click();
    assert.match(await dialog(ben).locator('.sign-summary').textContent(), /^Ben allowed scribe to submit contributions under “Charter” until /);
    await signOpenDialog(ben);
    await status(ben, 'scribe may now submit contributions under “Charter”.');

    // 10. Scribe stores its artifact and signs contribution.submitted.
    const scribe = new ExofabClient({ baseUrl: server.url, token: scribeToken });
    const { state } = await scribe.getProject(pid);
    const grant = state.delegations.find((d) => d.agent === scribeKey.id && !d.revoked);
    const stored = await scribe.putBlob(pid, utf8(ARTIFACT), TEXT);
    await scribe.appendSigned({
      pid,
      identity: scribeKey,
      kind: 'contribution.submitted',
      body: {
        title: CONTRIBUTION,
        summary: 'Scales recipe amounts by a factor; the synthetic tests in the file pass.',
        artifact: { uri: stored.uri, digest: stored.digest },
        agreement: grant.agreement,
        delegation: grant.id,
      },
    });

    // Ben is the principal, so the page offers him no review.
    await reload(ben, 'project');
    assert.equal(await ben.getByRole('button', { name: `Review “${CONTRIBUTION}”` }).isDisabled(), true);

    // 11. Ada reviews the exact artifact bytes, then accepts as steward.
    await reload(ada, 'project');
    await tamper(ada);
    await ada.getByRole('button', { name: `Review “${CONTRIBUTION}”` }).click();
    const alteredArtifact = dialog(ada);
    await alteredArtifact.getByText('The stored bytes do not match the digest in the record.').waitFor();
    assert.equal(await alteredArtifact.getByRole('button', { name: 'Review the record' }).isDisabled(), true, 'altered bytes cannot be reviewed');
    await alteredArtifact.getByRole('button', { name: 'Cancel' }).click();
    await ada.unroute(BLOBS);
    await settled(ada, 'project');
    await ada.getByRole('button', { name: `Review “${CONTRIBUTION}”` }).click();
    const review = dialog(ada);
    const [named, computed] = await review.locator('.facts-digests dd .mono').allTextContents();
    assert.equal(named, await sha256Hex(ARTIFACT));
    assert.equal(computed, named);
    assert.equal(await review.getByLabel('Artifact text preview', { exact: true }).textContent(), ARTIFACT);
    await review.getByLabel('Review note', { exact: true }).fill('Read the exact artifact bytes; the rules and tests meet the charter. (synthetic)');
    await review.getByRole('button', { name: 'Review the record' }).click();
    await signOpenDialog(ada);
    await status(ada, `You approved “${CONTRIBUTION}”.`);
    await settled(ada, 'project');

    await ada.getByRole('button', { name: `Accept “${CONTRIBUTION}”` }).click();
    assert.match(await dialog(ada).textContent(), /The review this acceptance cites/);
    await signOpenDialog(ada);
    await status(ada, `You accepted “${CONTRIBUTION}”.`);
    await settled(ada, 'project');

    // 12. The browser shows the accepted contribution and its own verification.
    const head = (await benClient.getProject(pid)).head;
    const contribution = ada.locator('article', { has: ada.getByRole('heading', { name: CONTRIBUTION }) });
    assert.equal((await contribution.locator('.state-accepted').textContent()).toLowerCase(), 'accepted');
    const verified = ada.locator('.verified');
    assert.match(await verified.textContent(), /^Verified in this browser8 records\./);
    assert.equal(await verified.locator('.mono').textContent(), head);
    await ada.screenshot({ path: join(SHOTS, 'project.png'), fullPage: true });

    // 13. The downloaded bundle is the verified history.
    const [download] = await Promise.all([ada.waitForEvent('download'), ada.getByRole('button', { name: 'Download bundle' }).click()]);
    const bundle = JSON.parse(await readFile(await download.path(), 'utf8'));
    const exported = await verifyBundle(bundle, { expectedHead: head, expectedProject: pid });
    assert.equal(exported.count, 8);
    assert.deepEqual(bundle.records.map((r) => r.kind), [
      'project.created',
      'agreement.proposed',
      'agreement.consented',
      'agreement.consented',
      'delegation.granted',
      'contribution.submitted',
      'contribution.reviewed',
      'contribution.accepted',
    ]);

    // 14. Ben's credit shows the accepted work, submitted via scribe.
    await go(ben, '#/profile', 'profile');
    const credit = ben.locator('section', { has: ben.getByRole('heading', { name: 'My credit' }) });
    assert.match(await credit.textContent(), new RegExp(`${CONTRIBUTION.replace(/[()]/g, '\\$&')}.*Submitted by agentscribe`));

    // 15. At phone width neither page scrolls sideways (Ada: project, Ben: profile).
    for (const [page, view] of [[ada, 'project'], [ben, 'profile']]) {
      await page.setViewportSize({ width: 360, height: 800 });
      const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      assert.ok(scroll <= client, `the ${view} page scrolls sideways at 360px (${scroll} > ${client})`);
    }
  } catch (error) {
    await ada.screenshot({ path: join(SHOTS, 'failure-ada.png'), fullPage: true }).catch(() => {});
    await ben.screenshot({ path: join(SHOTS, 'failure-ben.png'), fullPage: true }).catch(() => {});
    throw error;
  }
  assert.deepEqual(problems, [], 'no page errors or Content Security Policy violations');
});
