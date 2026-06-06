"""
optimize_me_v2.py - 优化版本：用向量化 NumPy 操作替代嵌套循环

优化前 (optimize_me.py) 瓶颈分析:
- compute_q_slow 使用了三层嵌套循环:
  外层 for crop_idx in range(n_crops)
  中层 for start, end, m in events[crop_idx]
  内层 for day in range(start, end+1): daily_q[day] += q
  时间复杂度 O(C * E * D), 其中 C=作物数, E=每作物事件数, D=灌水持续天数

优化方案:
1. 构建一个 (num_events, num_days) 的二维数组 contributions
2. 对于每个事件，使用切片或 np.arange 在对应日期区间填入 q 值
3. 沿事件维度求和 → 得到 daily_q
4. 所有操作都在 C 级别循环中完成，避免 Python 循环
"""
import numpy as np

# ---------- 模拟参数 (与 optimize_me.py 相同) ----------
num_crops = 8
num_days = 500               
irrigation_events = [
    [(10, 120, 80), (130, 250, 60), (260, 380, 60)],
    [(20, 130, 60), (140, 260, 60), (270, 390, 60)],
    [(15, 125, 70), (135, 255, 50), (265, 385, 50)],
    [(30, 140, 60), (150, 270, 60), (280, 400, 60)],
    [(5, 100, 90), (110, 210, 70), (220, 320, 60)],
    [(25, 135, 65), (145, 265, 55), (275, 395, 55)],
    [(10, 110, 75), (120, 230, 65), (240, 350, 55)],
    [(35, 145, 60), (155, 275, 60), (285, 405, 60)],
]
alpha = np.array([0.10, 0.05, 0.12, 0.11, 0.08, 0.07, 0.09, 0.13])

# ---------- 向量化实现 ----------

def compute_q_fast(alpha, events, num_days):
    """
    使用向量化 NumPy 操作计算灌水率 (快版本)

    原理:
    - 将所有事件展平为一个列表，每个事件包含 (作物索引, start, end, m)
    - 预分配贡献矩阵 contributions: (num_events, num_days)，初始值为0
    - 对每个事件，用切片赋值 contributions[e, start:end+1] = q_e
    - 沿 axis=0 求和得到 daily_q
    """
    # 收集所有事件并计算每个事件的 q 值
    flat_events = []  # 每个元素: (start, end, q)
    for crop_idx in range(len(alpha)):
        for start, end, m in events[crop_idx]:
            T = end - start + 1
            q = alpha[crop_idx] * m / (T * 8.64)
            flat_events.append((start, end, q))

    num_events = len(flat_events)
    # 创建贡献矩阵
    contributions = np.zeros((num_events, num_days), dtype=np.float64)

    # 向量化赋值：对每个事件使用切片
    for e, (start, end, q) in enumerate(flat_events):
        contributions[e, start:end+1] = q

    # 沿事件轴求和 → 每日灌水率
    daily_q = contributions.sum(axis=0)
    return daily_q


def compute_q_fast_fully_vectorized(alpha, events, num_days):
    """
    完全向量化版本（无 Python 循环）：
    使用广播和累积求和技术构建灌水率数组。

    原理：
    - 为每个事件构建一个布尔掩码数组（days 维度）
    - 将掩码乘以 q 值
    - 沿事件求和
    """
    # 展平事件
    starts = []
    ends = []
    qs = []
    for crop_idx in range(len(alpha)):
        for start, end, m in events[crop_idx]:
            T = end - start + 1
            q = alpha[crop_idx] * m / (T * 8.64)
            starts.append(start)
            ends.append(end)
            qs.append(q)

    starts = np.array(starts)
    ends = np.array(ends)
    qs = np.array(qs)
    num_events = len(starts)

    # 使用广播创建掩码: (num_events, num_days)
    days = np.arange(num_days)  # shape: (num_days,)
    # mask.shape = (num_events, num_days)
    mask = (days[np.newaxis, :] >= starts[:, np.newaxis]) & \
           (days[np.newaxis, :] <= ends[:, np.newaxis])

    # contributions.shape = (num_events, num_days)
    contributions = mask * qs[:, np.newaxis]

    daily_q = contributions.sum(axis=0)
    return daily_q


# ---------- 基准测试 ----------

def main():
    import time

    # 1) 验证结果一致性 (与优化前的慢版本对比)
    from optimize_me import compute_q_slow
    result_slow = compute_q_slow(alpha, irrigation_events, num_days)
    result_fast = compute_q_fast(alpha, irrigation_events, num_days)
    result_fast2 = compute_q_fast_fully_vectorized(alpha, irrigation_events, num_days)

    assert np.allclose(result_slow, result_fast), "compute_q_fast 结果不一致！"
    assert np.allclose(result_slow, result_fast2), "compute_q_fast_fully_vectorized 结果不一致！"
    print("✅ 正确性验证通过！所有版本结果一致。")
    print(f"   样本输出: {result_slow[:5]}")

    # 2) 性能对比
    print("\n" + "=" * 60)
    print("性能对比 (重复 50 次取平均)")
    print("=" * 60)

    N_RUNS = 50

    # 慢版本
    start = time.perf_counter()
    for _ in range(N_RUNS):
        compute_q_slow(alpha, irrigation_events, num_days)
    time_slow = (time.perf_counter() - start) / N_RUNS

    # 快版本 (半向量化)
    start = time.perf_counter()
    for _ in range(N_RUNS):
        compute_q_fast(alpha, irrigation_events, num_days)
    time_fast = (time.perf_counter() - start) / N_RUNS

    # 快版本 (全向量化)
    start = time.perf_counter()
    for _ in range(N_RUNS):
        compute_q_fast_fully_vectorized(alpha, irrigation_events, num_days)
    time_fast2 = (time.perf_counter() - start) / N_RUNS

    print(f"  原始 (嵌套循环):    {time_slow*1000:.4f} ms")
    print(f"  优化 (切片赋值):    {time_fast*1000:.4f} ms")
    print(f"  优化 (全向量化):    {time_fast2*1000:.4f} ms")
    print(f"  加速比 (切片版):    {time_slow / time_fast:.2f}x")
    print(f"  加速比 (全向量化):  {time_slow / time_fast2:.2f}x")

if __name__ == '__main__':
    main()