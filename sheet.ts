import fs from 'fs';
import path from 'path';
import readline from 'readline';

import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

import { ClassInfo, classToSlug, fetchClasses, generateTwitchTimestamp, parseMarkers, secondsToDHMS } from './search';

import { config } from 'dotenv';
config();

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const TOKEN_PATH = 'token.json';
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;

// #region Node.js quickstart
// https://developers.google.com/sheets/api/quickstart/nodejs

fs.readFile('credentials.json', (err, content) => {
  if (err) return console.log('Error loading client secret file:', err);
  // Authorize a client with credentials, then call the Google Sheets API.
  authorize(JSON.parse(content.toString()), main);
});

function authorize(credentials: any, callback: (oAuth2Client: OAuth2Client) => void) {
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getNewToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token.toString()));
    callback(oAuth2Client);
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getNewToken(oAuth2Client: OAuth2Client, callback: (oAuth2Client: OAuth2Client) => void) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Authorize this app by visiting this url:', authUrl);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Enter the code from that page here: ', code => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Error while trying to retrieve access token', err);
      oAuth2Client.setCredentials(token!);
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), err => {
        if (err) return console.error(err);
        console.log('Token stored to', TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
  });
}

// #endregion Node.js quickstart

function formatMarkers(info: ClassInfo, marker: string) {
  if (marker.startsWith('Raiding')) {
    return `=HYPERLINK("https://twitch.tv/${marker.split('Raiding ')[1]}", "${marker}")`;
  }
  const slideMatch = marker.match(/^#(\d+)\s/);
  if (slideMatch) {
    return `=HYPERLINK("${info.links?.Slides}#/${slideMatch[1]}", "${marker}")`;
  }
  return marker;
}

async function* generateWorksheetData() {
  for (const info of await fetchClasses()) {
    const markersPath = path.join(info.absolute, 'markers');
    if (!fs.existsSync(markersPath)) continue;

    info.markers = await parseMarkers(markersPath);

    const rawOffset = info.links?.YouTube.split('t=')[1];
    const offset = rawOffset ? -rawOffset! : 0;

    const rows = [];
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
    yield {
      title: classToSlug(info),
      info,
      rows,
    };
  }
}

async function main(client: OAuth2Client) {
  const sheets = google.sheets({ version: 'v4', auth: client });
  const spreadsheet = (await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID })).data;

  const templateWorksheet = spreadsheet.sheets?.find(worksheet => worksheet.properties?.title === 'Template')!;

  for await (const { info, title, rows } of generateWorksheetData()) {
    console.log(title);
    if (!spreadsheet.sheets?.find(worksheet => worksheet.properties?.title === title)) {
      const response = await sheets.spreadsheets.sheets.copyTo({
        sheetId: templateWorksheet.properties?.sheetId,
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { destinationSpreadsheetId: SPREADSHEET_ID },
      });
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId: response.data.sheetId,
                  title,
                },
                fields: 'title',
              },
            },
          ],
        },
      });
      if (info.isOfficeHours) {
        await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `${title}!B2` });
      }
    }
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [
          {
            range: `${title}!A3:C${3 + rows.length}`,
            values: rows,
          },
        ],
      },
    });
  }
}
