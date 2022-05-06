import fs from 'fs';
import readline from 'readline';

import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

import { config } from 'dotenv';
config();

// https://developers.google.com/sheets/api/quickstart/nodejs
export function authorize(credentials: any, namespace: string, scopes: string[]) {
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  // Check if we have previously stored a token.
  console.log('Reading Token...');
  return fs.promises
    .readFile(`${namespace}-token.json`)
    .then(token => {
      oAuth2Client.setCredentials(JSON.parse(token.toString()));
      return oAuth2Client;
    })
    .catch(() => getNewToken(oAuth2Client, namespace, scopes));
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getNewToken(oAuth2Client: OAuth2Client, namespace: string, scopes: string[]) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
  });
  console.log('Authorize this app by visiting this url:', authUrl);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<OAuth2Client>((resolve, reject) => {
    rl.question('Enter the code from that page here: ', code => {
      rl.close();
      oAuth2Client.getToken(code, (err, token) => {
        if (err) return reject('Error while trying to retrieve access token: ' + err);
        oAuth2Client.setCredentials(token!);
        // Store the token to disk for later program executions
        return fs.promises
          .writeFile(`${namespace}-token.json`, JSON.stringify(token))
          .then(() => resolve(oAuth2Client));
      });
    });
  });
}
