import fs from 'fs';
import path from 'path';
import {
  chatToSecondsMap,
  ClassInfo,
  classToSlug,
  fetchClasses,
  parseChat,
  parseMarkers,
  secondsToDHMS,
} from './search';

function* getWhatsMissing(info: ClassInfo) {
  if (!fs.existsSync(path.join(info.absolute, 'chat.json'))) yield 'chat.json';
  if (!fs.existsSync(path.join(info.absolute, 'markers'))) yield 'markers';
  if (!info.isOfficeHours) {
    if (!fs.existsSync(path.join(info.absolute, 'captions'))) yield 'captions';
    if (!info.links?.YouTube) yield 'YouTube link';
    if (!info.links?.Tweet) yield 'Tweet link';
    if (!info.links?.Slides) yield 'Slides link';
  } else if (!info.video) yield 'Video';
  if (!info.links?.Twitch) yield 'Twitch link';
  if (!info.links?.Discord) yield 'Discord link';
}

const getWordBefore = (string: string, ...args: Parameters<typeof String.prototype.split>) =>
  string
    .split(...args)[0]
    .split(/\s+/)
    .slice(-1)[0];

fetchClasses().then(async classes => {
  for (const info of classes) {
    let log = (message: string) => {
      console.log('\t' + classToSlug(info));
      log = console.log.bind(console);
      log(message);
    };

    const missing = Array.from(getWhatsMissing(info));
    if (missing.length) log(`missing ${Array.from(getWhatsMissing(info)).join(', ')}`);

    const markersPath = path.join(info.absolute, 'markers');
    if (!fs.existsSync(markersPath)) continue;

    info.markers = await parseMarkers(markersPath);
    const entries = Array.from(info.markers?.entries()!);
    const places = secondsToDHMS(entries[entries.length - 1][0]).split(':').length;
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

    const chatPath = path.join(info.absolute, 'chat.json');
    if (!fs.existsSync(chatPath)) continue;

    const lastMarker = Array.from(info.markers!.keys()).slice(-1)[0];
    const lastChat = Array.from(chatToSecondsMap((await parseChat(chatPath))!).keys()).slice(-1)[0];
    if (lastMarker < lastChat) continue;

    log(classToSlug(info) + ` has a marker ${(lastChat - lastMarker).toFixed(2)} seconds after the last chat`);
  }
});
