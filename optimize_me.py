"""
optimize_me.py - 原始慢版本，包含嵌套循环瓶颈
瓶颈：使用嵌套循环逐日累加灌水率 (O(N_crops * N_events * N_days))
"""
import numpy as np

# 模拟参数 (扩大规模以凸显性能差异)
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

def compute_q_slow(alpha, events, num_days):
    """
    使用嵌套循环逐日计算灌水率 (慢版本)
    """
    daily_q = np.zeros(num_days)
    n_crops = len(alpha)
    for crop_idx in range(n_crops):
        for start, end, m in events[crop_idx]:
            T = end - start + 1
            q = alpha[crop_idx] * m / (T * 8.64)
            for day in range(start, end + 1):
                daily_q[day] += q
    return daily_q

def main():
    result = compute_q_slow(alpha, irrigation_events, num_days)
    print("慢版本完成，结果样本：", result[:5])
    for _ in range(10):
        compute_q_slow(alpha, irrigation_events, num_days)
    print("重复10次完成")

if __name__ == '__main__':
    main()