import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';
import { ClassInfo, fetchClasses, parseMarkers, populateClassNumbers, SecondsMap, secondsToDHMS } from './search';
import { chooseClasses, offsetTimestamps } from './shared';

function filterMarkersForYouTube(markers: SecondsMap): SecondsMap {
  return new Map(
    Array.from(markers.entries()).filter(
      ([_, string]) => string.match(/^#\d+\s+/) || string.match(/^(timer|break) (started|ended)/i),
    ),
  );
}

const COMMENT_PREFIX = `Here are timestamps for the slides, for whomever needs them:

`;

function generateYoutubeComment(markers: SecondsMap): string {
  const entries = Array.from(filterMarkersForYouTube(markers)).reverse();
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
  const chosenClasses = await chooseClasses<ClassInfo>(
    classes.filter(info => info.links?.YouTube),
    'Class(es) to generate comments for',
    info => info,
  );
  await Promise.all(
    chosenClasses.map(async info => {
      info.markers = await parseMarkers(path.join(info.absolute, 'markers'));
    }),
  );

  if (fs.existsSync('comments')) await fs.promises.rm('comments');

  return Promise.all(chosenClasses
    .map(info => [info.links?.YouTube!, generateYoutubeComment(offsetTimestamps(info.markers!, offset))])
    .filter(([_, comment]) => comment)
    .map(([url, comment]) => fs.promises.appendFile('comments', '\t' + url + '\n' + comment + '\n\t' + url)));
});
