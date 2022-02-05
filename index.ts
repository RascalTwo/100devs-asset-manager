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

const parseChapters = makeParser<SecondsMap>(absolute =>
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

const parseCaptions = makeParser<SecondsMap>(absolute => {
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

const parseChat = makeParser<ChatInfo>(absolute =>
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

interface ClassInfo {
  dirname: string;
  date: Date;
  absolute: string;
  links: null | Record<'Twitch' | 'YouTube', string>;
  chapters: null | SecondsMap;
  captions: null | SecondsMap;
  chat: null | ChatInfo;
  isOfficeHours: boolean;
}

const root = path.join(path.dirname(__filename), '..');
const fetchClasses = (): Promise<ClassInfo[]> =>
  Promise.all(
    fs
      .readdirSync(root)
      .filter(dirname => dirname.match(/\d{4}(-\d{2}){2}/))
      .map(async dirname => {
        const absolute = path.join(root, dirname);
        const links = await parseLinks(path.join(absolute, 'links'));
        const chapters = await parseChapters(path.join(absolute, 'chapters'));
        const captions = await parseCaptions(path.join(absolute, 'captions'));
        const chat = await parseChat(path.join(absolute, 'chat.json'));

        const [year, month, dayOfMonth] = dirname.split('-').map(Number);
        const date = new Date(year, month - 1, dayOfMonth);

        return {
          dirname,
          date,
          absolute,
          links,
          chapters,
          captions,
          chat,
          isOfficeHours: date.getDay() === 0,
        };
      }),
  );

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

fetchClasses().then(classes => {
  console.log(
    classes
      .map(info => [info, [...getWhatsMissing(info)]] as [ClassInfo, string[]])
      .filter(([_, missing]) => missing.length)
      .map(([info, missing]) => `${info.dirname} is missing ${missing.join(', ')}`)
      .join('\n'),
  );
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
      ({
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

        const classMatches = classes
          .map(info => {
            const matches = [];
            if (includes(info.dirname, query)) matches.push(info.dirname);
            if (info.chapters && haystacks.chapters)
              matches.push(...secondsMapToLines(info, searchSecondsMapForNeedle(info.chapters, query, includes)));
            if (info.captions && haystacks.captions)
              matches.push(...secondsMapToLines(info, searchSecondsMapForNeedle(info.captions, query, includes)));
            if (info.chat && haystacks.chat)
              matches.push(
                ...secondsMapToLines(info, searchSecondsMapForNeedle(chatToSecondsMap(info.chat), query, includes)),
              );
            if (info.links && haystacks.links)
              matches.push(
                ...Object.entries(info.links)
                  .filter(parts => parts.some(part => includes(part, query)))
                  .map(parts => parts.join(': ')),
              );
            return [info, matches] as [ClassInfo, string[]];
          })
          .filter(([_, matches]) => matches.length);
        if (!classMatches.length) console.log('No matches found');
        for (const [info, matches] of classMatches) {
          console.log(
            `${info.dirname} with ${matches.length} matches:\n${
              info.links ? (info.links.Twitch || info.links.YouTube) + '\n' : ''
            }`,
          );
          console.log(matches.join('\n'));
        }
      },
    );
});
