"""Fibonacci 函数优化：使用 functools.lru_cache 将时间复杂度从指数级降为线性 O(n)"""

from functools import lru_cache

# ---------- 统一接口：使用 LRU 缓存的 fib ----------
@lru_cache(maxsize=None)
def fib(n):
    """使用 functools.lru_cache 优化的 Fibonacci 函数（自顶向下，缓存所有中间结果）"""
    if n <= 1:
        return n
    return fib(n-1) + fib(n-2)

# ---------- 保留原有函数供参考 ----------

def fibonacci_memo(n, memo=None):
    """递归版 Fibonacci + 记忆化（自顶向下）"""
    if memo is None:
        memo = {}
    if n in memo:
        return memo[n]
    if n <= 1:
        result = n
    else:
        result = fibonacci_memo(n-1, memo) + fibonacci_memo(n-2, memo)
    memo[n] = result
    return result

def fibonacci_iterative(n):
    """迭代版 Fibonacci（已为线性，无需缓存）"""
    if n <= 1:
        return n
    a, b = 0, 1
    for _ in range(2, n+1):
        a, b = b, a + b
    return b

# 快速测试与性能对比
if __name__ == "__main__":
    import time

    # 测试正确性
    for i in range(10):
        assert fib(i) == fibonacci_iterative(i), f"不匹配于 {i}"
    print("正确性验证通过。")

    # 性能对比（使用较大的 n）
    n = 35
    print(f"\n计算 Fibonacci({n})：")

    # 新实现：lru_cache fib
    start = time.perf_counter()
    result_new = fib(n)
    time_new = time.perf_counter() - start
    print(f"  新实现 (lru_cache): 结果 = {result_new}, 耗时 = {time_new:.6f}秒")

    # 记忆化版本
    start = time.perf_counter()
    result_memo = fibonacci_memo(n)
    time_memo = time.perf_counter() - start
    print(f"  记忆化递归: 结果 = {result_memo}, 耗时 = {time_memo:.6f}秒")

    # 迭代版本
    start = time.perf_counter()
    result_iter = fibonacci_iterative(n)
    time_iter = time.perf_counter() - start
    print(f"  迭代循环:   结果 = {result_iter}, 耗时 = {time_iter:.6f}秒")

    # 原始递归版本（指数级，仅测试小 n 以避免崩溃）
    def fibonacci_naive(n):
        if n <= 1:
            return n
        return fibonacci_naive(n-1) + fibonacci_naive(n-2)

    n_small = 30
    start = time.perf_counter()
    result_naive = fibonacci_naive(n_small)
    time_naive = time.perf_counter() - start
    print(f"\n原始递归（指数级）测试 n={n_small}：")
    print(f"  结果 = {result_naive}, 耗时 = {time_naive:.6f}秒")
    print("  扩展至 n=35 将需要数分钟甚至更久。")