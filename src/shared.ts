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


export const offsetTimestamps = (map: SecondsMap, offset: number) => {
  return new Map([...map.entries()].map(([seconds, string]) => [seconds + offset, string]));
}

export function filterMarkersForPublic(markers: SecondsMap): SecondsMap {
  return new Map(
    Array.from(markers.entries()).filter(
      ([_, string]) =>
        string.startsWith('Question of the Day') || string.match(/^#\d+\s+/) || string.match(/ (started|ended)$/i),
    ),
  );
}
