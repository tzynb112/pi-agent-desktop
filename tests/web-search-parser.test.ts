import assert from 'assert/strict';
import * as webScraper from '../src/main/web-scraper';

const parseDuckDuckGoSearchResults = (webScraper as any).parseDuckDuckGoSearchResults;

assert.equal(typeof parseDuckDuckGoSearchResults, 'function', 'expected search parser export to exist');

const html = `
  <html>
    <body>
      <div class="result">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa">Result A</a>
        <div class="result__snippet">Snippet A</div>
      </div>
      <div class="result">
        <a rel="nofollow" class="result__a" href="https://example.com/b">Result B</a>
        <div class="result__snippet">Snippet B</div>
      </div>
    </body>
  </html>
`;

const results = parseDuckDuckGoSearchResults(html, 5);

assert.equal(results.length, 2);
assert.equal(results[0].title, 'Result A');
assert.equal(results[0].url, 'https://example.com/a');
assert.equal(results[0].snippet, 'Snippet A');
assert.equal(results[1].title, 'Result B');
assert.equal(results[1].url, 'https://example.com/b');
assert.equal(results[1].snippet, 'Snippet B');

console.log('web search parser test passed');
