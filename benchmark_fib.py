"""
基准测试：对比新旧 Fibonacci 实现
- 验证 fib(0) 到 fib(10) 正确性
- 测量旧实现（朴素递归）与新实现（lru_cache 记忆化）计算 fib(35) 的性能
- 报告加速比
"""

import sys
import time

# ---------- 旧实现：朴素递归（指数级） ----------
def fib_naive(n):
    """朴素递归 Fibonacci，时间复杂度 O(2^n)"""
    if n <= 1:
        return n
    return fib_naive(n-1) + fib_naive(n-2)


# ---------- 新实现：使用 lru_cache 的记忆化递归 ----------
from fib import fib


# ---------- 1. 正确性验证 ----------
print("=" * 60)
print("正确性验证：fib(0) 到 fib(10)")
print("=" * 60)

# 已知正确的 Fibonacci 数列
expected = [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55]

print(f"{'n':<5} {'new (lru_cache)':<20} {'old (naive)':<20} {'expected':<20}")
print("-" * 65)

fib.cache_clear()  # 确保新实现从空缓存开始

all_correct = True
for n in range(11):
    new_val = fib(n)
    old_val = fib_naive(n)
    exp_val = expected[n]
    match = "✓" if new_val == old_val == exp_val else "✗"
    if match != "✓":
        all_correct = False
    print(f"{n:<5} {new_val:<20} {old_val:<20} {exp_val:<20} {match}")

if all_correct:
    print("\n✅ 所有结果正确！")
else:
    print("\n❌ 存在错误！")
    sys.exit(1)


# ---------- 2. 性能对比 (fib(35)) ----------
N = 35
print("\n" + "=" * 60)
print(f"性能对比：fib({N})")
print("=" * 60)

# 测量旧实现（朴素递归）—— 只运行一次，因为它很慢
print("\n正在运行旧实现（朴素递归），请稍候...")
start_old = time.perf_counter()
result_old = fib_naive(N)
time_old = time.perf_counter() - start_old
print(f"  旧实现结果: {result_old}")
print(f"  旧实现耗时: {time_old:.6f} 秒")

# 测量新实现（lru_cache）—— 清除缓存以确保公平测量
fib.cache_clear()
start_new = time.perf_counter()
result_new = fib(N)
time_new = time.perf_counter() - start_new
print(f"\n  新实现结果: {result_new}")
print(f"  新实现耗时: {time_new:.6f} 秒")

# 确保结果一致
assert result_old == result_new, "结果不一致！"

# 计算加速比
if time_new > 0:
    speedup = time_old / time_new
else:
    speedup = float('inf')

print(f"\n{'=' * 60}")
print(f"加速比: {speedup:.2f}x")
print(f"{'=' * 60}")

if speedup > 100:
    print("🎉 性能提升显著！记忆化将指数级复杂度降为线性。")
else:
    print("✅ 性能提升明显。")