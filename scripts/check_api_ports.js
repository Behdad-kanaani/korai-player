const fetch = require('node-fetch');
(async () => {
  const ports = Array.from({length: 21}, (_,i) => 3000 + i);
  for (const p of ports) {
    try {
      const url = `http://127.0.0.1:${p}/api/plugins`;
      const res = await fetch(url, {timeout: 2000});
      if (res.ok) {
        console.log('OK', p);
        const data = await res.json().catch(() => null);
        console.log(JSON.stringify({port: p, plugins: data && data.plugins ? data.plugins.map(x=>({id:x.id,name:x.name,enabled:x.enabled,builtin:x.builtin})) : data}, null, 2));
        process.exit(0);
      }
    } catch (e) {}
  }
  console.error('No API found on tested ports');
  process.exit(2);
})();
