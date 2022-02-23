import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';

const makeParser =
  <T>(parse: (absolute: string) => Promise<null | T>) =>
  (absolute: string) => {
    if (!fs.existsSync(absolute)) return Promise.resolve(null);
    return parse(absolute);
  };

const readFileString = (path: string) => fs.promises.readFile(path).then(b => b.toString());

export type SecondsMap = Map<number, string>;

const parseLinks = makeParser<Record<'Twitch' | 'YouTube', string>>(absolute =>
  readFileString(absolute).then(text =>
    text
      .trim()
      .split('\n')
      .map(line => line.split(':').map(part => part.trim()))
      .reduce((links, [key, ...value]) => ({ ...links, [key]: value.join(':') }), { Twitch: '', YouTube: '' }),
  ),
);

export const parseMarkers = makeParser<SecondsMap>(absolute =>
  readFileString(absolute).then(text =>
    text
      .trim()
      .split('\n')
      .map(line => line.split('\t'))
      .reduce((times, [time, title]) => {
        const parts = time.split(':').map(Number);
        let hours = 0;
        let minutes = 0;
        let seconds = 0;
        if (parts.length === 3) [hours, minutes, seconds] = parts;
        else if (parts.length === 2) [minutes, seconds] = parts;
        else if (parts.length === 1) [seconds] = parts;

        times.set(seconds + minutes * 60 + hours * 60 * 60, title);
        return times;
      }, new Map<number, string>()),
  ),
);

export const parseCaptions = makeParser<SecondsMap>(absolute => {
  const minuteCaptions = fs.readdirSync(absolute).find(filename => filename.endsWith('.txt'));
  if (!minuteCaptions) return Promise.resolve(null);
  return readFileString(path.join(absolute, minuteCaptions))
    .then(text => text.trim().split('\n'))
    .then(lines => {
      const times = new Map<number, string>();

      let time = '';
      let content: string[] = [];
      const addToMap = () => {
        if (!time) return;

        const [hours, minutes] = time.split(':').map(Number);
        times.set((minutes + hours * 60) * 60, content.join(' '));
        time = '';
        content = [];
      };
      for (const line of lines) {
        if (line.match(/^\d{2}:\d{2}$/gi)) {
          if (time) addToMap();
          time = line;
        } else {
          content.push(line);
        }
      }
      addToMap();

      return times;
    });
});

export const parseChat = makeParser<ChatInfo>(absolute =>
  readFileString(absolute)
    .then(JSON.parse)
    .then(messages =>
      messages.map(({ created_at, commenter: { display_name }, message: { body } }: any) => ({
        created_at: new Date(created_at),
        display_name,
        body,
      })),
    )
    .then(messages => ({
      started: messages[0].created_at,
      messages,
    })),
);

interface ChatInfo {
  started: Date;
  messages: ChatMessage[];
}

interface ChatMessage {
  created_at: Date;
  display_name: string;
  body: string;
}

export interface ClassInfo {
  dirname: string;
  date: Date;
  absolute: string;
  links: null | Record<'Twitch' | 'YouTube', string>;
  markers?: null | SecondsMap;
  captions?: null | SecondsMap;
  chat?: null | ChatInfo;
  isOfficeHours: boolean;
  number?: number;
  video?: string;
}

const getMissingStrings = (classes: ClassInfo[]) => {
  function* getWhatsMissing(info: ClassInfo) {
    if (!fs.existsSync(path.join(info.absolute, 'chat.json'))) yield 'chat.json';
    if (!info.links) yield 'links';
    if (!fs.existsSync(path.join(info.absolute, 'markers'))) yield 'markers';
    if (!info.isOfficeHours) {
      if (!fs.existsSync(path.join(info.absolute, 'captions'))) yield 'captions';
      if (info.links && !info.links.YouTube) yield 'YouTube link';
    } else if (!info.video) yield 'Video';
    if (info.links && !info.links.Twitch) yield 'Twitch link';
  }
  return classes
    .map(info => [info, [...getWhatsMissing(info)]] as [ClassInfo, string[]])
    .filter(([_, missing]) => missing.length)
    .map(([info, missing]) => `${info.dirname} is missing ${missing.join(', ')}`);
};

const fetchClasses = (): Promise<ClassInfo[]> =>
  Promise.all(
    fs
      .readdirSync('..')
      .filter(dirname => dirname.match(/\d{4}(-\d{2}){2}/))
      .map(async dirname => {
        const absolute = path.join('..', dirname);

        const [year, month, dayOfMonth] = dirname.split('-').map(Number);
        const date = new Date(year, month - 1, dayOfMonth);
        const videoFilename = (await fs.promises.readdir(absolute)).find(filename => filename.endsWith('.mp4'));

        return {
          dirname,
          date,
          absolute,
          links: await parseLinks(path.join(absolute, 'links')),
          isOfficeHours: date.getDay() === 0,
          video: videoFilename ? path.join(absolute, videoFilename) : undefined,
        };
      }),
  );

const searchSecondsMapForNeedle = (
  obj: SecondsMap,
  needle: string,
  includes: ReturnType<typeof includesGenerator>,
): SecondsMap => {
  return new Map([...obj.entries()].filter(([_, haystack]) => includes(haystack, needle)));
};

/**
 * Convert seconds to DHMS
 *
 * @param {number} seconds
 * @returns {string}
 */
export function secondsToDHMS(seconds: number, minimalPlaces = 1) {
  // TODO - fix this rushed math
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds - days * 86400) / 3600);
  const minutes = Math.floor((seconds % (60 * 60)) / 60);
  const parts = [days, hours, minutes, Math.floor(seconds % 60)];
  while (!parts[0] && parts.length > minimalPlaces) parts.shift();
  return parts.map(num => num.toString().padStart(2, '0')).join(':');
}

export function generateTwitchTimestamp(seconds: number, minimalPlaces: number = 1) {
  const symbols = ['d', 'h', 'm'];
  const dhms = Array.from(secondsToDHMS(seconds, minimalPlaces));

  // 0:1:2:3 -> 0:1:2m3 -> 0:1h2m3 -> 0d1h2m3
  while (true) {
    const index = dhms.lastIndexOf(':');
    if (index === -1) break;
    dhms[index] = symbols.pop()!;
  }

  return dhms.join('') + 's';
}

const secondsMapToLines = (url: string, map: SecondsMap) => {
  const entries = [...map.entries()].reverse();
  if (!entries.length) return [];

  let prefix = url + '?t=';
  const places = secondsToDHMS(entries[0][0]).split(':').length;
  return entries
    .reverse()
    .map(([seconds, haystack]) => `${prefix + generateTwitchTimestamp(seconds, places)}\t${haystack}`);
};

const chatToSecondsMap = (chatInfo: ChatInfo) => {
  const started = chatInfo.messages[0].created_at;
  return chatInfo.messages.reduce((map, message) => {
    const seconds = (message.created_at.getTime() - started.getTime()) / 1000;
    map.set(seconds, `${message.display_name}: ${message.body}`);
    return map;
  }, new Map<number, string>());
};

const includesGenerator = (caseInsensitive: boolean) => (haystack: string, needle: string) =>
  caseInsensitive ? haystack.toLowerCase().includes(needle) : haystack.includes(needle);

const matchesToAbbr = (matches: Record<'markers' | 'captions' | 'links' | 'chat' | 'raw', string[]>) => {
  const parts = [];
  if (matches.markers.length) parts.push('ch:' + matches.markers.length);
  if (matches.captions.length) parts.push('cap:' + matches.captions.length);
  if (matches.links.length) parts.push('lnk:' + matches.links.length);
  if (matches.chat.length) parts.push('ct:' + matches.chat.length);
  if (matches.raw.length) parts.push('raw:' + matches.markers.length);
  return '(' + parts.join(', ') + ')';
};

export function populateClassNumbers(classes: ClassInfo[]) {
  let counts = { 0: 0, 1: 0 };
  classes.forEach(info => {
    info.number = ++counts[Number(info.isOfficeHours) as 0 | 1];
  });
  return classes;
}

export const classToSlug = (info: ClassInfo) =>
  `${info.isOfficeHours ? 'O-' : 'C-'}${info.number?.toString().padStart(2, '0')} ${info.dirname}`;

if (require.main === module)
  fetchClasses().then(classes => {
    populateClassNumbers(classes);
    console.log(getMissingStrings(classes).join('\n'));
    return inquirer
      .prompt([
        {
          name: 'query',
          message: 'Text to search for',
          validate: text => !!text.trim().length,
        },
        {
          type: 'checkbox',
          name: 'haystackNames',
          message: 'Assets to search within',
          choices: ['markers', 'links', 'captions', 'chat'],
          default: ['markers', 'links'],
        },
        {
          type: 'confirm',
          name: 'caseInsensitive',
          message: 'Case insensitive?',
          default: true,
        },
      ])
      .then(
        async ({
          caseInsensitive,
          query,
          haystackNames,
        }: {
          caseInsensitive: boolean;
          query: string;
          haystackNames: string[];
        }) => {
          const haystacks = haystackNames.reduce<Record<'markers' | 'captions' | 'links' | 'chat', true>>(
            (stack, name) => ({ ...stack, [name]: true }),
            {} as any,
          );

          if (caseInsensitive) query = query.toLowerCase();
          const includes = includesGenerator(caseInsensitive);

          const classMatches = (
            await Promise.all(
              classes.map(async info => {
                const url = info.links!.Twitch || info.links!.YouTube;

                const matches: Record<'markers' | 'captions' | 'links' | 'chat' | 'raw', string[]> = {
                  markers: [],
                  captions: [],
                  links: [],
                  chat: [],
                  raw: [],
                };
                if (includes(info.dirname, query)) matches.raw.push(info.dirname);
                if (haystacks.markers) {
                  if (info.markers === undefined)
                    info.markers = await parseMarkers(path.join(info.absolute, 'markers'));
                  if (info.markers)
                    matches.markers = secondsMapToLines(url, searchSecondsMapForNeedle(info.markers, query, includes));
                }
                if (haystacks.captions) {
                  if (info.captions === undefined)
                    info.captions = await parseCaptions(path.join(info.absolute, 'captions'));
                  if (info.captions)
                    matches.captions = secondsMapToLines(
                      url,
                      searchSecondsMapForNeedle(info.captions, query, includes),
                    );
                }
                if (haystacks.chat) {
                  if (info.chat === undefined) info.chat = await parseChat(path.join(info.absolute, 'chat.json'));
                  if (info.chat)
                    matches.chat = secondsMapToLines(
                      url,
                      searchSecondsMapForNeedle(chatToSecondsMap(info.chat), query, includes),
                    );
                }
                if (info.links && haystacks.links)
                  matches.links = Object.entries(info.links)
                    .filter(parts => parts.some(part => includes(part, query)))
                    .map(parts => parts.join(': '));
                return [info, matches] as [
                  ClassInfo,
                  Record<'markers' | 'captions' | 'links' | 'chat' | 'raw', string[]>,
                ];
              }),
            )
          ).filter(([_, matches]) => Object.values(matches).some(m => m.length));
          if (!classMatches.length) return console.log('No matches found');

          while (true) {
            const chosenClasses =
              classMatches.length === 1
                ? classMatches
                : await inquirer
                    .prompt([
                      {
                        type: 'checkbox',
                        name: 'chosen',
                        message: 'Class(es) to view matches of',
                        choices: classMatches.map(([info, matches], i) => ({
                          name: `${classToSlug(info)} - ${matchesToAbbr(matches)}`,
                          value: i,
                        })),
                        loop: false,
                      },
                    ])
                    .then(({ chosen }: { chosen: number[] }) => classMatches.filter((_, i) => chosen.includes(i)));
            if (!chosenClasses.length) break;

            const replRegex = new RegExp(`(${query})`, 'ig');
            for (const [info, matches] of chosenClasses) {
              console.log(
                `${info.dirname} with ${matchesToAbbr(matches)} matches:\n${
                  info.links ? (info.links.Twitch || info.links.YouTube) + '\n' : ''
                }`,
              );
              for (const [haystack, lines] of Object.entries(matches)) {
                if (!lines.length) continue;
                console.log('\t' + haystack.toUpperCase());
                console.log(lines.join('\n').replace(replRegex, chalk.bgWhite.black('$1')));
              }
            }

            if (classMatches.length === 1) break;
          }
        },
      );
  });

export { fetchClasses };
