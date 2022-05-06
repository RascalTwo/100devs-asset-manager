import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { google } from 'googleapis';
import { firefox, Page } from 'playwright';

import { config } from 'dotenv';
import { ClassInfo, fetchClasses, parseMarkers } from './search';
import { generateYoutubeComment, offsetTimestamps } from './shared';
import { authorize } from './google-auth';
config();

const EMAIL = process.env.YOUTUBE_EMAIL;
const PASSWORD = process.env.YOUTUBE_PASSWORD;

type CommentHashes = Record<string, [string, boolean]>;

async function getUpdatingComments(hashes: CommentHashes) {
  const updating: { hash: string; text: string; info: ClassInfo; justVerify: boolean }[] = [];
  for (const info of await fetchClasses().then(classes => classes.filter(info => info.links['YouTube Comment']))) {
    const rawOffset = info.links.YouTube.split('t=')[1];
    const offset = rawOffset ? -rawOffset! : 0;

    const text = generateYoutubeComment(
      offsetTimestamps((await parseMarkers(path.join(info.absolute, 'markers')))!, offset),
    );

    const hash = crypto.createHash('md5').update(text).digest('hex');

    const cid = info.links['YouTube Comment'];
    const prev = hashes[cid];
    if (prev && prev[0] === hash && prev[1]) continue;
    updating.push({ hash, text, info, justVerify: prev && prev[1] === false });
  }
  return updating;
}

(async () => {
  if (!EMAIL || !PASSWORD)
    return console.error('YOUTUBE_EMAIL and YOUTUBE_PASSWORD environment variables are required');

  const hashes: CommentHashes = fs.existsSync('youtube-comment-hashes.json')
    ? JSON.parse((await fs.promises.readFile('youtube-comment-hashes.json')).toString())
    : {};

  const updating = await getUpdatingComments(hashes);

  if (!updating.length) return console.log('No changes detected');

  console.log(
    `${updating.length} comments out of date, ${
      updating.filter(v => v.justVerify).length
    } of which only need verification`,
  );

  const browser = await firefox.launch({
    headless: false,
    args: ['--disable-dev-shm-usage'],
    ignoreDefaultArgs: ['--disable-component-extensions-with-background-pages'],
  });
  const context = await browser.newContext();
  if (fs.existsSync('youtube-comment-hashes.json'))
    await context.addCookies(JSON.parse((await fs.promises.readFile('youtube-cookies.json')).toString()));

  const client = await fs.promises
    .readFile('credentials.json')
    .then(credentials =>
      authorize(JSON.parse(credentials.toString()), 'youtube', [
        'https://www.googleapis.com/auth/youtube.force-ssl',
        'https://www.googleapis.com/auth/youtube',
        'https://www.googleapis.com/auth/youtube.readonly',
      ]),
    );

  const youtube = google.youtube('v3');

  const getPage = (() => {
    let page: Page | null = null;
    return async () => {
      if (page) return page;

      console.log('Opening Browser...');
      page = await context.newPage();

      await page.goto('https://www.youtube.com/', { waitUntil: 'networkidle' });
      await page.waitForTimeout(5000);
      if (await page.$('#buttons > ytd-button-renderer')) {
        console.log('Logging in...');
        await page.locator('#buttons > ytd-button-renderer').click();
        await page.waitForTimeout(2000);
        await page.locator('#identifierId').fill(EMAIL);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(2000);
        await page.locator('input[type="password"]').fill(PASSWORD);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(2000);
      } else {
        console.log('Resuming previous login session...');
      }

      await fs.promises.writeFile('youtube-cookies.json', JSON.stringify(await context.cookies()));

      return page;
    };
  })();

  for (let i = 0; i < updating.length; i++) {
    const { hash, text, info, justVerify } = updating[i];
    if (justVerify) continue;
    const page = await getPage();

    console.log('Setting', info.dirname);
    const CID = info.links['YouTube Comment'];
    await page.goto(info.links.YouTube + '&lc=' + info.links['YouTube Comment'], { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);
    await page.evaluate(() => window.scrollBy({ top: 750 }));
    await page.waitForTimeout(5000);
    await page.evaluate(
      CID =>
        (
          document
            .querySelector(`a[href*="${CID}"]`)!
            .closest('ytd-comment-thread-renderer')!
            .querySelector('#action-menu button') as HTMLButtonElement
        ).click(),
      CID,
    );
    await page.locator('ytd-menu-navigation-item-renderer:has-text("Edit")').click();
    await page.locator('#contenteditable-root').fill(text);
    await page.locator('#submit-button').click();
    await page.waitForTimeout(2500);

    hashes[CID] = [hash, false];
    await fs.promises.writeFile('youtube-comment-hashes.json', JSON.stringify(hashes, null, '  '));
  }

  for (const [i, comment] of (
    await youtube.comments.list({
      auth: client,
      part: 'snippet',
      id: updating.map(({ info }) => info.links['YouTube Comment']).join(','),
      textFormat: 'plainText',
    })
  ).data.items!.entries()) {
    const CID = updating[i].info.links['YouTube Comment'];

    let validated = comment.snippet?.textOriginal === updating[i].text;
    if (validated) {
      hashes[CID][1] = true;
    } else {
      delete hashes[CID];
    }

    console.log(updating[i].info.dirname, validated ? 'validated' : 'not synced');
    await fs.promises.writeFile('youtube-comment-hashes.json', JSON.stringify(hashes, null, '  '));
  }

  return browser.close();
})().catch(console.error);
