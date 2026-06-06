"""
单元测试：验证 optimize_me_v2.py 中的向量化实现与原始慢版本结果一致。
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
import pytest

# ---------- Test data ----------
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


@pytest.fixture
def reference_result():
    """使用原始慢版本计算参考结果。"""
    from optimize_me import compute_q_slow
    return compute_q_slow(alpha, irrigation_events, num_days)


def test_compute_q_fast(reference_result):
    """测试 compute_q_fast 与慢版本一致。"""
    from optimize_me_v2 import compute_q_fast
    result = compute_q_fast(alpha, irrigation_events, num_days)
    assert np.allclose(result, reference_result), \
        "compute_q_fast 结果与慢版本不一致"


def test_compute_q_fast_fully_vectorized(reference_result):
    """测试 compute_q_fast_fully_vectorized 与慢版本一致。"""
    from optimize_me_v2 import compute_q_fast_fully_vectorized
    result = compute_q_fast_fully_vectorized(alpha, irrigation_events, num_days)
    assert np.allclose(result, reference_result), \
        "compute_q_fast_fully_vectorized 结果与慢版本不一致"


def test_two_fast_versions_are_identical():
    """测试两个快速版本之间结果一致。"""
    from optimize_me_v2 import compute_q_fast, compute_q_fast_fully_vectorized
    r1 = compute_q_fast(alpha, irrigation_events, num_days)
    r2 = compute_q_fast_fully_vectorized(alpha, irrigation_events, num_days)
    assert np.allclose(r1, r2), "两个快速版本结果不一致"


def test_small_case():
    """测试小规模数据以确保正确性。"""
    from optimize_me_v2 import compute_q_fast
    # 简单场景：1种作物，1个事件，持续3天
    alpha_small = np.array([0.1])
    events_small = [[(0, 2, 100)]]
    # 预期：第0-2天 q = 0.1 * 100 / (3*8.64) = 10 / 25.92 ≈ 0.3858
    expected = np.zeros(5)
    q = 0.1 * 100 / (3 * 8.64)
    expected[0:3] = q
    result = compute_q_fast(alpha_small, events_small, 5)
    assert np.allclose(result, expected), f"小规模测试失败: {result} != {expected}"


def test_no_events():
    """测试无事件时返回全零。"""
    from optimize_me_v2 import compute_q_fast
    result = compute_q_fast(alpha, [[] for _ in range(len(alpha))], num_days)
    assert np.allclose(result, np.zeros(num_days)), "无事件应返回全零数组"


def test_single_event():
    """测试单一作物单一事件。"""
    from optimize_me_v2 import compute_q_fast
    alpha_single = np.array([0.2])
    events_single = [[(10, 20, 50)]]
    result = compute_q_fast(alpha_single, events_single, 30)
    # 手动计算
    t = 20 - 10 + 1
    q = 0.2 * 50 / (t * 8.64)
    expected = np.zeros(30)
    expected[10:21] = q
    assert np.allclose(result, expected), "单个事件测试失败"