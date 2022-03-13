import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';

(async () => {
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
})();
