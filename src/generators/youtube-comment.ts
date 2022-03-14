import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';
import { ClassInfo, fetchClasses, parseMarkers, populateClassNumbers, SecondsMap, secondsToDHMS } from '../search';
import { chooseClass, filterMarkersForPublic, offsetTimestamps } from '../shared';

const COMMENT_PREFIX = `Here are timestamps for the slides, for whomever needs them:

`;

function generateYoutubeComment(markers: SecondsMap): string {
  const entries = Array.from(filterMarkersForPublic(markers)).reverse();
  if (!entries.length) return '';

  const places = secondsToDHMS(entries[0][0]).split(':').length;
  return (
    COMMENT_PREFIX +
    entries
      .reverse()
      .map(([seconds, string]) => secondsToDHMS(seconds, places) + '\t' + string)
      .join('\n')
  );
}

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
