import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import { ClassInfo, classToSlug, SecondsMap } from './search';

export function chooseClass<T>(
  classes: ClassInfo[],
  message: string,
  generateValue: (info: ClassInfo, i: number) => T,
  generateName: (info: ClassInfo, i: number) => string = info => classToSlug(info),
) {
  return performChoice<T>('list', classes, message, generateValue, generateName) as Promise<T>;
}

export function chooseClasses<T>(
  classes: ClassInfo[],
  message: string,
  generateValue: (info: ClassInfo, i: number) => T,
  generateName: (info: ClassInfo, i: number) => string = info => classToSlug(info),
): Promise<T[]> {
  return performChoice<T>('checkbox', classes, message, generateValue, generateName) as Promise<T[]>;
}

interface performChoice<T> {
  (
    classes: ClassInfo[],
    message: string,
    generateValue: (info: ClassInfo, i: number) => T,
    generateName?: (info: ClassInfo, i: number) => string,
  ): Promise<T[]>;
}

const performChoice = <T>(
  type: 'list' | 'checkbox',
  classes: ClassInfo[],
  message: string,
  generateValue: (info: ClassInfo, i: number) => T,
  generateName: (info: ClassInfo, i: number) => string = info => classToSlug(info),
): Promise<T | T[]> =>
  inquirer
    .prompt<{ output: T | T[] }>([
      {
        type,
        message,
        name: 'output',
        choices: classes.map((info, i) => ({
          name: generateName(info, i),
          value: generateValue(info, i),
        })),
        loop: false,
      },
    ])
    .then(({ output }) => output);

export const getMissingStrings = (classes: ClassInfo[]) => {
  function* getWhatsMissing(info: ClassInfo) {
    if (!fs.existsSync(path.join(info.absolute, 'chat.json'))) yield 'chat.json';
    if (!fs.existsSync(path.join(info.absolute, 'markers'))) yield 'markers';
    if (!info.isOfficeHours) {
      if (!fs.existsSync(path.join(info.absolute, 'captions'))) yield 'captions';
      if (!info.links?.YouTube) yield 'YouTube link';
      if (!info.links?.Tweet) yield 'Tweet link';
      if (!info.links?.Slides) yield 'Slides link';
    } else if (!info.video) yield ' Video';
    if (!info.links?.Twitch) yield 'Twitch link';
    if (!info.links?.Discord) yield 'Discord link';
  }
  return classes
    .map(info => [info, [...getWhatsMissing(info)]] as [ClassInfo, string[]])
    .filter(([_, missing]) => missing.length)
    .map(([info, missing]) => `${classToSlug(info)} is missing ${missing.join(', ')}`);
};

export const offsetTimestamps = (map: SecondsMap, offset: number) => {
  return new Map([...map.entries()].map(([seconds, string]) => [seconds + offset, string]));
}