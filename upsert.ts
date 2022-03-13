import fs from 'fs';
import path from 'path';
import childProcess from 'child_process';

import inquirer from 'inquirer';

import { ClassInfo, fetchClasses } from './search';
import { chooseClass } from './shared';
import { config } from 'dotenv';
config();

async function create(): Promise<void> {
  const { date, twitchVod, discordLink }: { date: string; twitchVod: string; discordLink: string } =
    await inquirer.prompt([
      {
        type: 'input',
        name: 'date',
        message: 'Date of Stream',
        validate: input => (input.match(/^\d{4}-\d{2}-\d{2}$/) ? true : 'Must be in YYYY-MM-DD format'),
      },
      {
        type: 'input',
        name: 'twitchVod',
        message: 'Twitch VOD ID',
        validate: input => (input.match(/\d{10}$/) ? true : 'Must at least end with a Twitch VOD ID'),
      },
      {
        type: 'input',
        name: 'discordLink',
        message: 'Discord Message Link',
      },
    ]);
  const twitchVodID = twitchVod.split('/').slice(-1)[0];
  const absolute = path.join(__dirname, '../../', date);
  await fs.promises.mkdir(absolute);
  await fs.promises.writeFile(
    path.join(absolute, 'links'),
    `Twitch: https://www.twitch.tv/videos/${twitchVodID}\nDiscord: ${discordLink}`,
  );
}

async function updateFile(filepath: string) {
  const content = fs.existsSync(filepath) ? (await fs.promises.readFile(filepath)).toString() : '';
  const { newContent } = await inquirer.prompt<{ newContent: string }>([
    {
      type: 'editor',
      name: 'newContent',
      default: content,
    },
  ]);
  if (!newContent || newContent === content) return;
  return fs.promises.writeFile(filepath, newContent);
}

async function moveFile(origin: string, dest: string) {
  try {
    await fs.promises.rename(origin, dest);
  } catch (e) {
    await fs.promises.copyFile(origin, dest);
    await fs.promises.rm(origin);
  }
}

async function downloadCaptions(info: ClassInfo) {
  const filename = childProcess
    .execSync(`yt-dlp --write-auto-sub --sub-lang en --skip-download "${info.links?.YouTube}"`)
    .toString()
    .match(/\[download\] Destination: (.*)\n/)![1];

  const captionsFolder = path.join(info.absolute, 'captions');
  if (!fs.existsSync(captionsFolder)) await fs.promises.mkdir(captionsFolder);

  const vttDest = path.join(captionsFolder, filename);
  await moveFile(path.join(__dirname, '..', filename), vttDest);

  childProcess.execSync(`python3.8 "${process.env.VTT_TO_TXT_ABSOLUTE_PATH}" "${vttDest}"`);
}

async function downloadVideo(info: ClassInfo) {
  const stdout = await new Promise<string>((resolve, reject) => {
    const ytDlp = childProcess.exec(`yt-dlp -f 1080p60 "${info.links?.Twitch}"`);
    let stdout = '';

    ytDlp.stdout?.setEncoding('utf8');
    ytDlp.stdout?.on('data', data => {
      const strMessage = data.toString();
      process.stdout.write(strMessage);
      stdout += strMessage;
    });

    ytDlp.on('close', () => resolve(stdout));
    ytDlp.on('error', reject);
  });
  console.log({ stdout });
  const filename = (stdout.match(/\[download\] Destination: (.*)\n/) ||
    stdout.match(/\[download\] (.*) has already been downloaded\n/))![1];
  await moveFile(path.join(__dirname, '..', filename), path.join(info.absolute, filename));
}

async function downloadChat(info: ClassInfo) {
  const vodID = info.links?.Twitch.split('/').slice(-1)[0]!;
  childProcess.execSync(
    `python3.8 ${process.env.CHAT_DOWNLOAD_SCRIPT}/download.py ${vodID} ${process.env.TWITCH_CLIENT_ID}`,
    { stdio: 'inherit' },
  );

  return moveFile(
    path.join(process.env.CHAT_DOWNLOAD_SCRIPT!, 'output', vodID + '.json'),
    path.join(info.absolute, 'chat.json'),
  );
}

async function update() {
  const info = await chooseClass(await fetchClasses(), 'Choose class to update', info => info);
  if (!info) return;

  const choices = ['Links', 'Markers'];
  if (info.links?.YouTube && !fs.existsSync(path.join(info.absolute, 'captions'))) choices.push('Download Captions');
  if (info.isOfficeHours && !info.video) choices.push('Download Video');
  if (!fs.existsSync(path.join(info.absolute, 'chat.json'))) choices.push('Download Chat');

  const { property } = await inquirer.prompt<{ property: string }>({
    type: 'list',
    name: 'property',
    message: 'Property to Update',
    choices: choices,
  });
  switch (property) {
    case 'Links':
    case 'Markers':
      await updateFile(path.join(info.absolute, property.toLowerCase()));
      break;
    case 'Download Captions':
      await downloadCaptions(info);
      break;
    case 'Download Video':
      await downloadVideo(info);
      break;
    case 'Download Chat':
      await downloadChat(info);
      break;
  }
}

async function menu(): Promise<void> {
  while (true) {
    const { choice }: { choice: 'Create' | 'Update' | 'Exit' } = await inquirer.prompt([
      {
        type: 'list',
        name: 'choice',
        message: 'Choose Action',
        choices: ['Update', 'Create', 'Exit'],
      },
    ]);
    switch (choice) {
      case 'Create':
        await create();
        break;
      case 'Update':
        await update();
        break;
      case 'Exit':
        return;
    }
  }
}

menu().catch(console.error);
