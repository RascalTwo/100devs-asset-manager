import path from 'path';
import fs from 'fs';

import { diffChars } from 'diff';

import { fetchClasses, parseMarkers, secondsToDHMS } from './search';
import { getSlidesText, parseSlideMarker } from './shared';
import chalk from 'chalk';

const generateDiffString = (oldStr: string, newStr: string) => {
  return diffChars(oldStr, newStr).reduce(
    ({ different, string }, part) => ({
      different: Boolean(different || part.added || part.removed),
      string: string + chalk[part.added ? 'green' : part.removed ? 'red' : 'white'](part.value),
    }),
    { different: false, string: '' },
  );
};

(async () => {
  const info = (
    await fetchClasses().then(classes =>
      classes.filter(info => fs.existsSync(path.join(info.absolute, 'markers')) && info.links?.Slides),
    )
  ).at(+process.argv.at(-1)! || -1)!;

  let log = (message: string) => {
    console.log('\t' + path.join(info.absolute, 'markers'));
    log = console.log.bind(console);
    log(message);
  };
  const markersPath = path.join(info.absolute, 'markers');

  const slidesText = await getSlidesText(info);
  info.markers = await parseMarkers(markersPath);
  const places = secondsToDHMS([...info.markers!.keys()].at(-1)!).split(':').length;
  for (const [seconds, marker] of info.markers!.entries()) {
    const slideMarker = parseSlideMarker(marker);
    if (!slideMarker) continue;
    const { number, title, subtitle } = slideMarker;

    const slideText = slidesText[number].trim();
    const { different, string } = generateDiffString(title + (subtitle ? ' ' + subtitle : ''), slideText);
    if (different)
      log(secondsToDHMS(seconds, places) + '  ' + '#' + number.toString().padStart(places, '0') + '  ' + string);
  }
})().catch(console.error);
