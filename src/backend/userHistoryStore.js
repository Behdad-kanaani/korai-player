'use strict';

const fs = require('fs');
const path = require('path');

const writeQueues = new Map();

function persistUserHistory(userHistory, userDataPath) {
  if (!userDataPath) return Promise.resolve();
  const historyPath = path.join(userDataPath, 'user_history.json');
  const payload = JSON.stringify(userHistory, null, 2);
  const previous = writeQueues.get(historyPath) || Promise.resolve();
  const write = previous.catch(() => {}).then(async () => {
    const tempPath = `${historyPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    let handle;
    try {
      handle = await fs.promises.open(tempPath, 'wx');
      await handle.writeFile(payload, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.promises.rename(tempPath, historyPath);
    } catch (error) {
      if (handle) { try { await handle.close(); } catch {} }
      try { await fs.promises.unlink(tempPath); } catch {}
      throw error;
    }
  });
  writeQueues.set(historyPath, write);
  return write.finally(() => {
    if (writeQueues.get(historyPath) === write) writeQueues.delete(historyPath);
  });
}

async function flushUserHistoryWrites(userDataPath) {
  if (!userDataPath) return;
  const historyPath = path.join(userDataPath, 'user_history.json');
  const pending = writeQueues.get(historyPath);
  if (pending) await pending;
}

module.exports = { persistUserHistory, flushUserHistoryWrites };
