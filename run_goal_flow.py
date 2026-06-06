import json, time

with open('D:/UI交互开发/test_goal.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

print(f"目标: {data['goal']}")
print("开始执行子任务:\n")

for task in data['tasks']:
    task_id = task['id']
    desc = task['description']
    status = task['status']
    print(f"[步骤 {task_id}] 初始状态: {status}")
    print(f"[步骤 {task_id}] 开始执行: {desc}")
    # 模拟执行延迟
    time.sleep(0.5)
    print(f"[步骤 {task_id}] 模拟执行中...")
    time.sleep(1)
    print(f"[步骤 {task_id}] 完成\n")

print("所有子任务执行完毕。")