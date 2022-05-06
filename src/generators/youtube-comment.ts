import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';
import { ClassInfo, fetchClasses, parseMarkers } from '../search';
import { chooseClass, generateYoutubeComment, offsetTimestamps } from '../shared';

fetchClasses().then(async classes => {
  const { offset } = await inquirer.prompt<{ offset: number }>([
    {
      type: 'number',
      name: 'offset',
      message: 'Twitch to YouTube start offset',
      default: 0,
    },
  ]);
  const info = await chooseClass<ClassInfo>(
    classes.filter(info => info.links?.YouTube),
    'Class to generate comment for',
    info => info,
  );

  if (fs.existsSync('youtube-comment')) await fs.promises.rm('youtube-comment');

  const comment = generateYoutubeComment(
    offsetTimestamps((await parseMarkers(path.join(info.absolute, 'markers')))!, offset),
  );
  return fs.promises.appendFile(
    'youtube-comment',
    '\t' + info.links?.YouTube + '\n' + comment + '\n\t' + info.links?.YouTube,
  );
});
