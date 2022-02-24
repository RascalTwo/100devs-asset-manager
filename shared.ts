import inquirer from 'inquirer';
import { ClassInfo, classToSlug } from './search';

export function chooseClass<T>(...args: Parameters<performChoice<T>>) {
  return performChoice<T>(...args).then(classes => classes[0]);
}

export function chooseClasses<T>(...args: Parameters<performChoice<T>>): Promise<T[]> {
  return performChoice<T>(...args);
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
  classes: ClassInfo[],
  message: string,
  generateValue: (info: ClassInfo, i: number) => T,
  generateName: (info: ClassInfo, i: number) => string = info => classToSlug(info),
): Promise<T[]> =>
  inquirer
    .prompt<{ classes: T[] }>([
      {
        type: 'checkbox',
        name: 'classes',
        message,
        choices: classes.map((info, i) => ({
          name: generateName(info, i),
          value: generateValue(info, i),
        })),
        loop: false,
      },
    ])
    .then(({ classes }) => classes);
