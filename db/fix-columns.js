import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('C:/ServerData/Repos/claude-capacity-model/db/capacity.db');
const cols = db.prepare('PRAGMA table_info(capacity)').all().map(r => r.name);

if (!cols.includes('department')) {
  db.exec('ALTER TABLE capacity ADD COLUMN department TEXT');
  console.log('Added department column');
}
if (!cols.includes('subcategory')) {
  db.exec('ALTER TABLE capacity ADD COLUMN subcategory TEXT');
  console.log('Added subcategory column');
}

console.log('Columns now:', db.prepare('PRAGMA table_info(capacity)').all().map(r => r.name).join(', '));
