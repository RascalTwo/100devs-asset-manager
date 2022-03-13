import inquirer from 'inquirer';
import path from 'path';
import { classToSlug, fetchClasses, parseMarkers, secondsToDHMS } from './search';

fetchClasses().then(async classes => {
  await Promise.all(
    classes.map(async info => {
      info.markers = await parseMarkers(path.join(info.absolute, 'markers'));
    }),
  );
  const { type } = await inquirer.prompt<{ type: 'Raid' | 'QOTD' }>([
    {
      type: 'list',
      name: 'type',
      choices: ['Raid', 'QOTD'],
    },
  ]);
  const keyword = type === 'Raid' ? 'raiding' : 'question of the day';
  classes
    .filter(({ markers }) => markers)
    .map(info => {
      const raided = Array.from(info.markers!.entries()).find(([_, marker]) => marker.toLowerCase().includes(keyword));
      return `${classToSlug(info)}\t${raided ? secondsToDHMS(raided[0]) + '\t' + raided[1] : ''}`;
    })
    .forEach(string => console.log(string));
});
