import path from 'path';

import { ClassInfo, fetchClasses, parseCaptions, parseChapters, parseChat } from '.';

function* getWhatsMissing(info: ClassInfo) {
  if (!info.chat) yield 'chat.json';
  if (!info.links) yield 'links';
  if (!info.chapters) yield 'chapters';
  if (!info.isOfficeHours) {
    if (!info.captions) yield 'captions';
    if (info.links && !info.links.YouTube) yield 'YouTube link';
  }
  if (info.links && !info.links.Twitch) yield 'Twitch link';
}
fetchClasses().then(async classes => {
  await Promise.all(
    classes.map(async info => {
      info.captions = await parseCaptions(path.join(info.absolute, 'captions'));
      info.chapters = await parseChapters(path.join(info.absolute, 'chapters'));
      info.chat = await parseChat(path.join(info.absolute, 'chat.json'));
    }),
  );
  console.log(
    classes
      .map(info => [info, [...getWhatsMissing(info)]] as [ClassInfo, string[]])
      .filter(([_, missing]) => missing.length)
      .map(([info, missing]) => `${info.dirname} is missing ${missing.join(', ')}`)
      .join('\n'),
  );
});
