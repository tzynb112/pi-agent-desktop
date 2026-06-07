import assert from 'assert/strict';
import {
  buildDuplicateGuiLaunchMessage,
  buildGuiLaunchSuccessMessage,
  createGuiLaunchTracker,
  extractGuiLaunchTarget,
  isGuiLaunchCommand,
  markGuiLaunchFailed,
  markGuiLaunchSucceeded,
  reserveGuiLaunchTarget,
} from '../src/shared/gui-launch-detection';

const tracker = createGuiLaunchTracker();
const tetrisCommand = 'cmd /c start "" "D:\\Games\\My Tetris.html"';

assert.equal(isGuiLaunchCommand(tetrisCommand), true);
assert.equal(extractGuiLaunchTarget(tetrisCommand), 'D:\\Games\\My Tetris.html');

const firstLaunch = reserveGuiLaunchTarget(tracker, tetrisCommand);
assert.ok(firstLaunch);
assert.equal(firstLaunch.isDuplicate, false);
assert.equal(firstLaunch.alreadyOpened, false);
assert.equal(firstLaunch.normalizedTarget, 'd:/games/my tetris.html');

const duplicateWhilePending = reserveGuiLaunchTarget(tracker, 'Invoke-Item "D:\\Games\\My Tetris.html"');
assert.ok(duplicateWhilePending);
assert.equal(duplicateWhilePending.isDuplicate, true);
assert.equal(duplicateWhilePending.alreadyOpened, false);

markGuiLaunchSucceeded(tracker, firstLaunch.normalizedTarget);

const duplicateAfterOpen = reserveGuiLaunchTarget(tracker, 'Start-Process "D:\\Games\\My Tetris.html"');
assert.ok(duplicateAfterOpen);
assert.equal(duplicateAfterOpen.isDuplicate, true);
assert.equal(duplicateAfterOpen.alreadyOpened, true);

const failedLaunch = reserveGuiLaunchTarget(tracker, 'Start-Process "D:\\Games\\Another Game.html"');
assert.ok(failedLaunch);
assert.equal(failedLaunch.isDuplicate, false);
markGuiLaunchFailed(tracker, failedLaunch.normalizedTarget);

const retryAfterFailure = reserveGuiLaunchTarget(tracker, 'Start-Process "D:\\Games\\Another Game.html"');
assert.ok(retryAfterFailure);
assert.equal(retryAfterFailure.isDuplicate, false);

assert.match(buildGuiLaunchSuccessMessage('(no output)'), /The file\/application IS open/);
assert.match(buildDuplicateGuiLaunchMessage('D:\\Games\\My Tetris.html'), /already open/);

console.log('gui-launch-detection tests passed');
