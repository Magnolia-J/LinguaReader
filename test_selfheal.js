const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = __dirname;
const testDir = path.join(root, '.test_heal');

// copy (do not delete via fs.rmSync to avoid sandbox interference)
fs.mkdirSync(testDir, { recursive: true });
fs.cpSync(path.join(root, 'data'), testDir, { recursive: true, force: true });

// corrupt store.json to empty
fs.writeFileSync(path.join(testDir, 'store.json'), JSON.stringify({
  books: [], progress: {}, kb: [], prefs: { enabledDicts: ['Le Robert'] },
  reading: { seconds: {}, byDate: {}, byBookDay: {} }, checkins: {}, lastBookId: null, deletedBookIds: []
}, null, 2));

console.log('corrupted store books:', JSON.parse(fs.readFileSync(path.join(testDir, 'store.json'), 'utf8')).books.length);

const child = spawn('node', ['server.js'], {
  cwd: root,
  env: { ...process.env, PORT: '3098', LR_DATA_DIR: testDir },
  stdio: 'ignore'
});

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  await wait(1200);
  try {
    const res = await fetch('http://localhost:3098/api/state');
    const state = await res.json();
    console.log('service books after recovery:', state.books.length, state.books.map(b => b.id).join(', '));
    const disk = JSON.parse(fs.readFileSync(path.join(testDir, 'store.json'), 'utf8'));
    console.log('disk books after recovery:', disk.books.length, disk.books.map(b => b.id).join(', '));
    if (state.books.length === 3 && disk.books.length === 3) {
      console.log('SELF-HEAL TEST PASSED');
    } else {
      console.log('SELF-HEAL TEST FAILED');
    }
  } catch (e) {
    console.log('test error:', e.message);
  } finally {
    child.kill('SIGTERM');
    await wait(300);
    // leave .test_heal for manual inspection; it is gitignored
    fs.unlinkSync(path.join(root, 'test_selfheal.js'));
  }
})();
