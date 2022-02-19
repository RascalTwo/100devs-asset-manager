import inquirer from 'inquirer';
import path from 'path';
import {
	ClassInfo,
  fetchClasses,
  parseMarkers,
  SecondsMap,
  secondsToDHMS,
} from './search';

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
  const chosenClasses = await inquirer
    .prompt([
      {
        type: 'checkbox',
        name: 'chosen',
        message: 'Class(es) to generate comments for',
        choices: classes
					.map((info, i) => [info, i] as [ClassInfo, number])
          .filter(([info]) => info.links?.YouTube)
          .map(([info, i]) => ({
            name: info.dirname,
            value: i,
          })),
        loop: false,
      },
    ])
    .then(({ chosen }: { chosen: number[] }) => classes.filter((_, i) => chosen.includes(i)));
  await Promise.all(
    chosenClasses.map(async info => {
      info.markers = await parseMarkers(path.join(info.absolute, 'markers'));
    }),
  );

  chosenClasses
    .map(info => [info.links?.YouTube!, generateYoutubeComment(info.markers!)])
    .filter(([_, comment]) => comment)
    .map(([url, comment]) => console.log('\t' + url + '\n' + comment + '\n\t' + url));
});
