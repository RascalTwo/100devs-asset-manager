import path from 'path';
import { classToSlug, fetchClasses, parseMarkers, secondsToDHMS } from './search';
import { getMissingStrings } from './shared';

fetchClasses().then(async classes => {
  console.log(getMissingStrings(classes).join('\n'));

  for (const info of classes) {
    let log = (message: string) => {
      console.log('\t' + classToSlug(info));
      log = console.log.bind(console);
      log(message);
    };

    const entries = Array.from((await parseMarkers(path.join(info.absolute, 'markers')))?.entries()!);
    const places = secondsToDHMS(entries[entries.length - 1][0]).split(':').length;

    let last = null;
    for (const [seconds, marker] of entries) {
      if (!marker) continue;
      const lowMarker = marker.toLowerCase();
      if (lowMarker.endsWith(' started')) {
        if (last !== null) {
          log(secondsToDHMS(seconds, places) + '\t' + 'Expected current to end before starting another');
        }
        last = lowMarker.split(' started')[0].trim();
      }
      if (lowMarker.endsWith(' ended')) {
        if (last === null) {
          log(secondsToDHMS(seconds, places) + '\t' + 'Expected start before an end');
        } else if (last !== lowMarker.split(' ended')[0].trim()) {
          log(secondsToDHMS(seconds, places) + '\t' + 'Expected end to match start');
        }
        last = null;
      }
    }
    if (last) {
      log('Never ended');
    }
  }
});
