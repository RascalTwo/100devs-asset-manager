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
import { getSlidesText } from './shared';

function* getWhatsMissing(info: ClassInfo) {
  if (!fs.existsSync(path.join(info.absolute, 'chat.json'))) yield 'chat.json';
  if (!fs.existsSync(path.join(info.absolute, 'markers'))) yield 'markers';
  if (!info.isOfficeHours) {
    if (!fs.existsSync(path.join(info.absolute, 'captions'))) yield 'captions';
    if (!info.links?.YouTube) yield `YouTube link (${60 - Math.ceil((Date.now() - info.date.getTime()) / 86400000)} days remaining)`;
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
  const ignoring = ((process.argv[2] ?? '').split('--ignore=')[1] ?? '').split(',');
  const IGNORE_SLIDES = ignoring.includes('slides');
  const IGNORE_CHAT = ignoring.includes('chat');

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

    let slidesText: string[] = [];
    if (info.links?.Slides) {
      slidesText = await getSlidesText(info);
    }

    info.markers = await parseMarkers(markersPath);
    const entries = Array.from(info.markers?.entries()!);
    const places = secondsToDHMS(entries[entries.length - 1][0]).split(':').length;
    let empty = false;
    let lastEvent = null;
    for (const [seconds, marker] of entries) {
      if (!marker) {
        empty = true;
        continue;
      }

      if (!IGNORE_SLIDES && marker.match(/^#\d+\s/)) {
        const number = +marker.split(' ')[0].slice(1);
        if (
          info.links?.Slides &&
          !slidesText[number].toLowerCase().includes(marker.split(' ').slice(1).join(' ').toLowerCase())
        ) {
          log(
            `${secondsToDHMS(seconds, places)}\t${slidesText[number]} does not contain "${marker}": ${
              info.links?.Slides
            }#/${number}`,
          );
        }
      }

      const lowMarker = marker.toLowerCase();
      if (lowMarker.endsWith(' started')) {
        if (lastEvent !== null) {
          log(secondsToDHMS(seconds, places) + '\t' + `Expected ${lastEvent} to end before starting another`);
        }
        if (!marker.endsWith(' Started')) {
          log(secondsToDHMS(seconds, places) + '\t' + 'Expected Started to be capitalized');
        }
        lastEvent = getWordBefore(marker, / started/i);
      }
      if (lowMarker.endsWith(' ended')) {
        if (lastEvent === null) {
          log(secondsToDHMS(seconds, places) + '\t' + 'Expected start before an end');
        } else if (lastEvent !== getWordBefore(marker, / ended/i)) {
          log(secondsToDHMS(seconds, places) + '\t' + 'Expected end to match start');
        }
        if (!marker.endsWith(' Ended')) {
          log(secondsToDHMS(seconds, places) + '\t' + 'Expected Ended to be capitalized');
        }
        lastEvent = null;
      }
    }
    if (lastEvent) log(`${lastEvent} never ended`);
    if (empty) log('Blank line within');

    const chatPath = path.join(info.absolute, 'chat.json');
    if (!fs.existsSync(chatPath)) continue;

    info.chat = await parseChat(chatPath)!;

    if (IGNORE_CHAT) continue;

    const firstDate = info.chat!.messages[0].created_at;
    if (
      `${firstDate.getFullYear()}-${(firstDate.getMonth() + 1).toString().padStart(2, '0')}-${firstDate
        .getDate()
        .toString()
        .padStart(2, '0')}` !== info.dirname
    ) {
      log(classToSlug(info) + ' chat has the wrong date ' + firstDate.toString());
    }

    const lastMarker = Array.from(info.markers!.keys()).slice(-1)[0];
    const lastChat = Array.from(chatToSecondsMap(info.chat!).keys()).slice(-1)[0];
    if (lastMarker < lastChat) continue;

    log(classToSlug(info) + ` has a marker ${(lastMarker - lastChat).toFixed(2)} seconds after the last chat`);
  }
});
