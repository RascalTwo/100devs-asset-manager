import fs from 'fs';
import path from 'path';
import childProcess from 'child_process';

import inquirer from 'inquirer';

import { ClassInfo, fetchClasses } from './search';
import { chooseClass } from './shared';
import { config } from 'dotenv';
config();

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
    `python3.8 ${process.env.CHAT_DOWNLOAD_SCRIPT}/download.py ${process.env.TWITCH_CLIENT_ID} ${vodID}`,
    { stdio: 'inherit' },
  );

  return moveFile(
    path.join(process.env.CHAT_DOWNLOAD_SCRIPT!, 'output', vodID + '.json'),
    path.join(info.absolute, 'chat.json'),
  );
}

(async () => {
  const info = await chooseClass(await fetchClasses(), 'Choose class to update', info => info);
  if (!info) return;

  while (true) {
    const choices = ['Links', 'Markers'];
    if (info.links?.YouTube && !fs.existsSync(path.join(info.absolute, 'captions'))) choices.push('Download Captions');
    if (info.isOfficeHours && !info.video) choices.push('Download Video');
    if (!fs.existsSync(path.join(info.absolute, 'chat.json'))) choices.push('Download Chat');

    const { property } = await inquirer.prompt<{ property: string }>({
      type: 'list',
      name: 'property',
      message: 'Property to Update',
      choices: [...choices, 'Exit'],
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
      case 'Exit':
        return;
    }
  }
})();
