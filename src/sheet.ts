import fs from 'fs';
import path from 'path';
import readline from 'readline';
import crypto from 'crypto';

import { google, sheets_v4 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

import { ClassInfo, classToSlug, fetchClasses, generateTwitchTimestamp, parseMarkers, secondsToDHMS } from './search';

import { config } from 'dotenv';
import { authorize } from './google-auth';
config();

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const IGNORE_HASHES = process.argv[2] === 'force';

fs.promises
  .readFile('credentials.json')
  .then(credentials =>
    authorize(JSON.parse(credentials.toString()), 'sheet', ['https://www.googleapis.com/auth/spreadsheets']),
  )
  .then(main);

function formatMarkers(info: ClassInfo, marker: string) {
  if (marker.startsWith('Raiding')) {
    return `=HYPERLINK("https://twitch.tv/${marker.split('Raiding ')[1]}", "${marker}")`;
  }

  if (info.links?.Slides) {
    const slideMatch = marker.match(/^#(\d+)\s/);
    if (slideMatch) return `=HYPERLINK("${info.links?.Slides}#/${slideMatch[1]}", "${marker}")`;
  }
  return marker;
}

async function generateWorksheetData() {
  const data = [];
  for (const info of await fetchClasses()) {
    const markersPath = path.join(info.absolute, 'markers');
    if (!fs.existsSync(markersPath)) continue;

    info.markers = await parseMarkers(markersPath);

    const rawOffset = info.links?.YouTube.split('t=')[1];
    const offset = rawOffset ? -rawOffset! : 0;

    const rows = [
      [
        info.links?.Twitch ? `=HYPERLINK("${info.links.Twitch}", "Twitch")` : 'Twitch',
        info.links?.YouTube ? `=HYPERLINK("${info.links.YouTube}", "YouTube")` : 'YouTube',
        '',
      ],
    ];
    const places = secondsToDHMS(Array.from(info.markers!.keys()).slice(-1)[0]).split(':').length;

    const twitchPrefix = `${info.links?.Twitch}?t=`;
    const youtubePrefix = info.links?.YouTube ? `${info.links.YouTube.split('?t=')[0]}?t=` : '';
    for (const [seconds, marker] of info.markers!.entries()) {
      const row = [
        `=HYPERLINK("${twitchPrefix}${generateTwitchTimestamp(seconds, places)}", "${secondsToDHMS(seconds, places)}")`,
        youtubePrefix && seconds + offset >= 0
          ? `=HYPERLINK("${youtubePrefix}${seconds + offset}", "${secondsToDHMS(seconds + offset, places)}")`
          : '',
        formatMarkers(info, marker.replaceAll('"', '"')),
      ];
      rows.push(row);
    }
    data.push({
      title: classToSlug(info),
      hash: crypto.createHash('md5').update(JSON.stringify(rows)).digest('hex'),
      info,
      rows,
    });
  }
  return data;
}

async function main(client: OAuth2Client) {
  const sheets = google.sheets({ version: 'v4', auth: client });
  console.log('Fetching Spreadsheet...');
  const spreadsheet = (await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID })).data;

  const worksheetTitleMap = spreadsheet.sheets!.reduce<Record<string, sheets_v4.Schema$Sheet>>(
    (map, worksheet) => ({ ...map, [worksheet.properties!.title!]: worksheet }),
    {},
  );
  const templateWorksheetID = worksheetTitleMap.Template.properties!.sheetId!;

  console.log('Generating Worksheets...');
  const worksheetsData = await generateWorksheetData();

  const missingWorksheetTitles = worksheetsData
    .filter(({ title }) => !(title in worksheetTitleMap))
    .map(({ title }) => title);
  if (missingWorksheetTitles.length) {
    console.log(`Creating ${missingWorksheetTitles.length} missing worksheets... `);
    const updateProperties: sheets_v4.Schema$SheetProperties[] = [];
    for (const title of missingWorksheetTitles) {
      updateProperties.push(
        await sheets.spreadsheets.sheets
          .copyTo({
            sheetId: templateWorksheetID,
            spreadsheetId: SPREADSHEET_ID,
            requestBody: { destinationSpreadsheetId: SPREADSHEET_ID },
          })
          .then(({ data: { sheetId } }) => ({ sheetId, title })),
      );
    }

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: updateProperties.map(({ sheetId, title }) => ({
          updateSheetProperties: {
            properties: {
              sheetId,
              title,
            },
            fields: 'title',
          },
        })),
      },
    });
  }
  console.log(`Fetching ${worksheetsData.length} worksheet hashes...`);
  const sheetHashes = (
    await sheets.spreadsheets.values.batchGet({
      spreadsheetId: SPREADSHEET_ID,
      ranges: worksheetsData.map(({ title }) => `${title}!Z1`),
    })
  ).data.valueRanges!.map(range => range.values?.[0][0] ?? null);
  const changedWorksheets = IGNORE_HASHES
    ? worksheetsData
    : worksheetsData.filter(({ hash }, i) => hash !== sheetHashes[i]);
  console.log(`${changedWorksheets.length} worksheets out of date`);

  for (const { title, hash, rows } of changedWorksheets) {
    console.log(title);

    const { values } = (
      await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${title}!A2:A`,
      })
    ).data;

    const valueRowCount = values?.length || 1;
    const paddedRows =
      rows.length >= valueRowCount
        ? rows
        : [...rows, ...Array.from<string[]>({ length: valueRowCount - rows.length }).fill(['', '', ''])];

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [
          {
            range: `${title}!A2:C${2 + paddedRows.length}`,
            values: paddedRows,
          },
          {
            range: `${title}!Z1`,
            values: [[hash]],
          },
        ],
      },
    });
  }
}
