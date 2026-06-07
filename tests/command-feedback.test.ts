import assert from 'assert/strict';
import {
  buildDownloadSuccessMessage,
  isDownloadCommand,
} from '../src/shared/command-feedback';

assert.equal(isDownloadCommand('git clone https://github.com/tzynb112/pi-agent-desktop.git'), true);
assert.equal(isDownloadCommand('curl -L -o file.zip https://example.com/file.zip'), true);
assert.equal(isDownloadCommand('echo hello'), false);

const noOutputMsg = buildDownloadSuccessMessage('git clone https://github.com/tzynb112/pi-agent-desktop.git', '(no output)');
assert.match(noOutputMsg, /files should now be available locally/i);
assert.match(noOutputMsg, /Do NOT retry it/i);

const outputMsg = buildDownloadSuccessMessage('curl -L -o file.zip https://example.com/file.zip', 'saved file.zip');
assert.match(outputMsg, /Output: saved file\.zip/);
assert.match(outputMsg, /download\/install operation completed successfully/i);

console.log('command-feedback tests passed');
