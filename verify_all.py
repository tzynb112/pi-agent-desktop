import sys
sys.stdout.reconfigure(encoding='utf-8')

checks = {
    r"D:\UI交互开发\src\main\main.ts": [
        ("MCP_REQUEST_TIMEOUT_MS", "Bug #1: MCP timeout"),
        ("pendingRequests.clear()", "Bug #1: pending cleanup"),
        ("Register only after full initialization", "Bug #10: late registration"),
        ("matchCount", "Bug #3: edit multi-match"),
        ("refineStart", "Bug #7: fuzzy refinement"),
        ("if ($?) {", "Bug #9: && conversion"),
        ("Command exited with code", "Bug #5: bash exit code"),
        ("主进程检测到执行中断", "Chinese strings fixed"),
        ("activeToolProcesses", "Long workflow: active bash process tracking"),
        ("tools-cancel-active", "Long workflow: active tool cancellation IPC"),
        ("Command cancelled by user", "Long workflow: cancelled command result"),
        ("runGoalInMainProcess", "Long workflow: main-process goal runner"),
        ("goal-run-execute", "Long workflow: main-process goal execution IPC"),
        ("buildGuiLaunchSuccessMessage", "GUI launch success messaging shared helper"),
        ("reserveGuiLaunchTarget", "GUI launch duplicate guard shared helper"),
        ("markGuiLaunchSucceeded", "GUI launch tracker success cleanup"),
        ("markGuiLaunchFailed", "GUI launch tracker failure cleanup"),
    ],
    r"D:\UI交互开发\src\shared\goal-executor.ts": [
        ("function isToolErrorResult", "Bug #2+#6: shared isToolError"),
        ("没有可用的代理", "Chinese strings fixed"),
        ("generateReliableGoalPlan", "Long workflow: reliable goal planning prompt"),
        ("executeReliableSubTask", "Long workflow: reliable subtask execution prompt"),
        ("const maxSteps = 30", "Long workflow: larger per-subtask step budget"),
    ],
    r"D:\UI交互开发\src\shared\gui-launch-detection.ts": [
        ("createGuiLaunchTracker", "GUI launch tracker state"),
        ("reserveGuiLaunchTarget", "GUI launch reservation guard"),
        ("buildDuplicateGuiLaunchMessage", "GUI launch duplicate response"),
    ],
    r"D:\UI交互开发\src\renderer\utils\goal-executor.ts": [
        ("export * from '../../shared/goal-executor'", "Long workflow: renderer goal executor re-exports shared implementation"),
    ],
    r"D:\UI交互开发\src\shared\ipc-types.ts": [
        ("cancelActiveTools", "Long workflow: cancellation API typed"),
        ("executeGoalRun", "Long workflow: main-process goal API typed"),
    ],
    r"D:\UI交互开发\src\main\preload.ts": [
        ("cancelActiveTools", "Long workflow: cancellation API exposed"),
        ("executeGoalRun", "Long workflow: main-process goal API exposed"),
    ],
    r"D:\UI交互开发\src\renderer\App.tsx": [
        ("executeGoalRun", "Long workflow: renderer delegates goal execution to main"),
    ],
    r"D:\UI交互开发\src\renderer\utils\tool-exec-loop.ts": [
        ("do NOT reset consecutiveFailures here", "Bug #4: circuit breaker"),
        ("extractGuiLaunchTarget", "GUI launch target extraction shared helper"),
    ],
    r"D:\UI交互开发\src\renderer\utils\tool-execution.ts": [
        ("工具失败", "Bug #6: Chinese error pattern"),
    ],
    r"D:\UI交互开发\src\renderer\utils\compactor.ts": [
        ("parentIds.has(m.id)", "Bug #8: branch preservation"),
        ("上下文压缩器", "Chinese strings fixed"),
    ],
}

absent_checks = {
    r"D:\UI交互开发\src\shared\goal-executor.ts": [
        ("浣犳槸", "Long workflow: no mojibake in executable goal prompt"),
        ("涓", "Long workflow: no common mojibake marker in goal executor"),
        ("鐩", "Long workflow: no common mojibake marker in goal executor"),
    ],
    r"D:\UI交互开发\src\main\goal-state.ts": [
        ("涓", "Long workflow: no common mojibake marker in persisted goal state"),
        ("鐩", "Long workflow: no common mojibake marker in persisted goal state"),
    ],
}

all_ok = True
for fpath, patterns in checks.items():
    with open(fpath, 'r', encoding='utf-8') as f:
        content = f.read()
    name = fpath.split('\\')[-1]
    for pattern, desc in patterns:
        if pattern in content:
            print(f"  OK  {name}: {desc}")
        else:
            print(f"  MISS {name}: {desc}")
            all_ok = False

for fpath, patterns in absent_checks.items():
    with open(fpath, 'r', encoding='utf-8') as f:
        content = f.read()
    name = fpath.split('\\')[-1]
    for pattern, desc in patterns:
        if pattern not in content:
            print(f"  OK  {name}: {desc}")
        else:
            print(f"  BAD {name}: {desc}")
            all_ok = False

print(f"\n{'All regression and long-workflow checks verified!' if all_ok else 'SOME CHECKS FAILED!'}")
