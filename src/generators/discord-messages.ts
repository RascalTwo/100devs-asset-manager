import fs from 'fs';
import path from 'path';
import { ClassInfo, fetchClasses, parseMarkers, SecondsMap, secondsToDHMS } from '../search';
import { chooseClass, } from '../shared';

const MAX_MESSAGE_LENGTH = 1750;

function generateDiscordMessages(markers: SecondsMap): string[] {
  const entries = Array.from(markers).reverse();
  if (!entries.length) return [];

  const places = secondsToDHMS(entries[0][0]).split(':').length;
  const lines = entries.reverse().map(([seconds, string]) => secondsToDHMS(seconds, places) + '\t' + string);
  const messages = lines.reduce(
    (messages, line) => {
      let latest = messages[messages.length - 1];
      if (latest.length + line.length <= MAX_MESSAGE_LENGTH) return [...messages.slice(0, -1), latest.trim() + '\n' + line.trim()];
      return [...messages.slice(0, -1), latest.trim() + '\n```', '```\n' + line.trim()];
    },
    ['```\n'],
  );
  if (!messages[messages.length - 1].endsWith('```')) messages[messages.length - 1] += '\n```';
  return messages;
}

fetchClasses().then(async classes => {
  const info = await chooseClass<ClassInfo>(classes, 'Class to generate discord messages for', info => info);
  info.markers = await parseMarkers(path.join(info.absolute, 'markers'));

  await Promise.all(
    (await fs.promises.readdir('.'))
      .filter(filename => filename.startsWith('discord-message.0'))
      .map(filename => fs.promises.rm(filename)),
  );

  for (const [i, message] of generateDiscordMessages(info.markers!).entries()) {
    console.log(message.length);
    await fs.promises.writeFile(`discord-message.${i.toString().padStart(2, '0')}`, message.trim());
  }
});
