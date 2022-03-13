import fs from 'fs';
import { parseMarkers, secondsToDHMS } from '../search';

(async () => {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination) {
    console.log('Source & Destination required');
    process.exit(1);
  }

  if (!fs.existsSync(source)) {
    console.log('Source file not found');
    process.exit(1);
  }

  const entries = Array.from((await parseMarkers(source))!.entries());
  const places = secondsToDHMS(entries[entries.length - 1][0]).split(':').length;
  const zero = entries[0][0];
  for (const entry of entries) {
    entry[0] -= zero;
  }

  return fs.promises.writeFile(
    destination,
    entries
      .slice(1)
      .reduce<string[]>((lines, [seconds, marker]) => [...lines, `${secondsToDHMS(seconds, places)}\t${marker}`], [])
      .join('\n'),
  );
})();
