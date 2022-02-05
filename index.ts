import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';

const makeParser =
  <T>(parse: (absolute: string) => Promise<null | T>) =>
  (absolute: string) => {
    if (!fs.existsSync(absolute)) return Promise.resolve(null);
    return parse(absolute);
  };

const readFileString = (path: string) => fs.promises.readFile(path).then(b => b.toString());

type SecondsMap = Map<number, string>;

const parseLinks = makeParser<Record<'Twitch' | 'YouTube', string>>(absolute =>
  readFileString(absolute).then(text =>
    text
      .trim()
      .split('\n')
      .map(line => line.split(':').map(part => part.trim()))
      .reduce((links, [key, ...value]) => ({ ...links, [key]: value.join(':') }), { Twitch: '', YouTube: '' }),
  ),
);

export const parseChapters = makeParser<SecondsMap>(absolute =>
  readFileString(absolute).then(text =>
    text
      .trim()
      .split('\n')
      .map(line => line.split('\t'))
      .reduce((times, [time, title]) => {
        const [hours, minutes, seconds] = time.split(':').map(Number);
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
  chapters?: null | SecondsMap;
  captions?: null | SecondsMap;
  chat?: null | ChatInfo;
  isOfficeHours: boolean;
}

const fetchClasses = (): Promise<ClassInfo[]> =>
  Promise.all(
    fs
      .readdirSync('..')
      .filter(dirname => dirname.match(/\d{4}(-\d{2}){2}/))
      .map(async dirname => {
        const absolute = path.join('..', dirname);

        const [year, month, dayOfMonth] = dirname.split('-').map(Number);
        const date = new Date(year, month - 1, dayOfMonth);

        return {
          dirname,
          date,
          absolute,
          links: await parseLinks(path.join(absolute, 'links')),
          isOfficeHours: date.getDay() === 0,
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

const secondsMapToLines = (info: ClassInfo, map: SecondsMap) => {
  let prefix = (info.links!.Twitch || info.links!.YouTube) + '?t=';
  return [...map.entries()].map(([seconds, haystack]) => `${prefix + seconds}\t${haystack}`);
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

const matchesToAbbr = (matches: Record<'chapters' | 'captions' | 'links' | 'chat' | 'raw', string[]>) => {
  const parts = [];
  if (matches.chapters.length) parts.push('ch:' + matches.chapters.length);
  if (matches.captions.length) parts.push('cap:' + matches.captions.length);
  if (matches.links.length) parts.push('lnk:' + matches.links.length);
  if (matches.chat.length) parts.push('ct:' + matches.chat.length);
  if (matches.raw.length) parts.push('raw:' + matches.chapters.length);
  return '(' + parts.join(', ') + ')';
};

if (require.main === module)
  fetchClasses().then(classes => {
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
          choices: ['chapters', 'links', 'captions', 'chat'],
          default: ['chapters', 'links'],
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
          const haystacks = haystackNames.reduce<Record<'chapters' | 'captions' | 'links' | 'chat', true>>(
            (stack, name) => ({ ...stack, [name]: true }),
            {} as any,
          );

          if (caseInsensitive) query = query.toLowerCase();
          const includes = includesGenerator(caseInsensitive);

          const classMatches = (
            await Promise.all(
              classes.map(async info => {
                const matches: Record<'chapters' | 'captions' | 'links' | 'chat' | 'raw', string[]> = {
                  chapters: [],
                  captions: [],
                  links: [],
                  chat: [],
                  raw: [],
                };
                if (includes(info.dirname, query)) matches.raw.push(info.dirname);
                if (haystacks.chapters) {
                  if (info.chapters === undefined)
                    info.chapters = await parseChapters(path.join(info.absolute, 'chapters'));
                  if (info.chapters)
                    matches.chapters = secondsMapToLines(
                      info,
                      searchSecondsMapForNeedle(info.chapters, query, includes),
                    );
                }
                if (haystacks.captions) {
                  if (info.captions === undefined)
                    info.captions = await parseCaptions(path.join(info.absolute, 'captions'));
                  if (info.captions)
                    matches.captions = secondsMapToLines(
                      info,
                      searchSecondsMapForNeedle(info.captions, query, includes),
                    );
                }
                if (haystacks.chat) {
                  if (info.chat === undefined) info.chat = await parseChat(path.join(info.absolute, 'chat.json'));
                  if (info.chat)
                    matches.chat = secondsMapToLines(
                      info,
                      searchSecondsMapForNeedle(chatToSecondsMap(info.chat), query, includes),
                    );
                }
                if (info.links && haystacks.links)
                  matches.links = Object.entries(info.links)
                    .filter(parts => parts.some(part => includes(part, query)))
                    .map(parts => parts.join(': '));
                return [info, matches] as [
                  ClassInfo,
                  Record<'chapters' | 'captions' | 'links' | 'chat' | 'raw', string[]>,
                ];
              }),
            )
          ).filter(([_, matches]) => Object.values(matches).some(m => m.length));
          if (!classMatches.length) console.log('No matches found');

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
                          name: `${info.dirname} - ${matchesToAbbr(matches)}`,
                          value: i,
                        })),
                        loop: false,
                      },
                    ])
                    .then(({ chosen }: { chosen: number[] }) => classMatches.filter((_, i) => chosen.includes(i)));
            if (!chosenClasses.length) break;

            for (const [info, matches] of chosenClasses) {
              console.log(
                `${info.dirname} with ${matchesToAbbr(matches)} matches:\n${
                  info.links ? (info.links.Twitch || info.links.YouTube) + '\n' : ''
                }`,
              );
              for (const [haystack, lines] of Object.entries(matches)) {
                if (!lines.length) continue;
                console.log('\t' + haystack.toUpperCase());
                console.log(lines.join('\n'));
              }
            }

            if (classMatches.length === 1) break;
          }
        },
      );
  });

export { fetchClasses };
