import fs from 'fs';
import path from 'path';
import { classToSlug, fetchClasses, parseMarkers, secondsToDHMS } from './search';
import { getMissingStrings } from './shared';

const getWordBefore = (string: string, ...args: Parameters<typeof String.prototype.split>) =>
  string
    .split(...args)[0]
    .split(/\s+/)
    .slice(-1)[0];

fetchClasses().then(async classes => {
  console.log(getMissingStrings(classes).join('\n'));

  for (const info of classes) {
    const markersPath = path.join(info.absolute, 'markers');
    if (!fs.existsSync(markersPath)) continue;

    const entries = Array.from((await parseMarkers(markersPath))?.entries()!);
    const places = secondsToDHMS(entries[entries.length - 1][0]).split(':').length;

    let log = (message: string) => {
      console.log('\t' + classToSlug(info));
      log = console.log.bind(console);
      log(message);
    };

    let empty = false;
    let last = null;
    for (const [seconds, marker] of entries) {
      if (!marker) {
        empty = true;
        continue;
      }

      const lowMarker = marker.toLowerCase();
      if (lowMarker.endsWith(' started')) {
        if (last !== null) {
          log(secondsToDHMS(seconds, places) + '\t' + 'Expected current to end before starting another');
        }
        if (!marker.endsWith(' Started')) {
          log(secondsToDHMS(seconds, places) + '\t' + 'Expected Started to be capitalized');
        }
        last = getWordBefore(marker, / started/i);
      }
      if (lowMarker.endsWith(' ended')) {
        if (last === null) {
          log(secondsToDHMS(seconds, places) + '\t' + 'Expected start before an end');
        } else if (last !== getWordBefore(marker, / ended/i)) {
          log(secondsToDHMS(seconds, places) + '\t' + 'Expected end to match start');
        }
        if (!marker.endsWith(' Ended')) {
          log(secondsToDHMS(seconds, places) + '\t' + 'Expected Ended to be capitalized');
        }
        last = null;
      }
    }
    if (last) log(`${last} never ended`);
    if (empty) log('Blank line within');
  }
});
