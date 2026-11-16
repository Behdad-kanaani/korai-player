const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { escapeHtml, genreFilterButtonHtml } = require('./htmlSecurity');

test('HTML escaping encodes text and attribute metacharacters in hostile payloads', () => {
  const payload = `"><img src=x onerror=alert(1)>\' & <svg onload=alert(2)>`;
  const encoded = escapeHtml(payload);
  assert.equal(encoded.includes('<'), false);
  assert.equal(encoded.includes('>'), false);
  assert.equal(encoded.includes('"'), false);
  assert.equal(encoded.includes("'"), false);
  assert.match(encoded, /&lt;img/);
  assert.match(encoded, /&#39;/);
  assert.match(encoded, /&amp;/);
});

test('genre filter markup keeps untrusted genre data in an encoded data attribute, not executable JavaScript', () => {
  const payload = `\\');alert(document.domain);//\" onmouseover=alert(1)`;
  const markup = genreFilterButtonHtml(payload, payload, true);
  assert.match(markup, /data-genre-filter="/);
  assert.match(markup, /&quot;/);
  assert.match(markup, /&#39;/);
  assert.doesNotMatch(markup, /onclick=/i);
  const attribute = markup.match(/data-genre-filter="([^"]*)"/);
  assert.ok(attribute, 'genre is represented by a data attribute');
  assert.doesNotMatch(attribute[1], /["']/);

  const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  assert.match(appSource, /data-genre-filter/);
  assert.doesNotMatch(appSource, /onclick="setLibraryGenreFilter\('\$\{escapedGenre\}'\)"/);
});
