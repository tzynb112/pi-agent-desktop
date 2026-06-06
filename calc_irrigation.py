import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.dates import DateFormatter, DayLocator, MonthLocator
from datetime import datetime, timedelta
import numpy as np

plt.rcParams['font.sans-serif'] = ['Microsoft YaHei', 'SimHei']
plt.rcParams['axes.unicode_minus'] = False
plt.rcParams['font.family'] = 'sans-serif'

# ========== 数据定义 ==========
# 总灌溉面积
A_total = 7.79  # 万亩

# 作物数据: (名称, 种植比例%, 灌水次数列表)
# 每次灌水: (开始日期, 结束日期, 灌水天数, 灌水定额 m3/亩)
crops = {
    '棉花': {
        'ratio': 10,  # %
        'irrigations': [
            ('04-06', '04-15', 10, 80),
            ('06-10', '06-20', 11, 60),
            ('07-01', '07-10', 10, 60),
            ('08-01', '08-10', 10, 60),
            ('09-11', '09-20', 10, 60),
        ]
    },
    '苜蓿': {
        'ratio': 5,
        'irrigations': [
            ('05-11', '05-20', 10, 60),
            ('06-01', '06-10', 10, 60),
            ('07-11', '07-20', 10, 60),
            ('08-01', '08-10', 10, 60),
            ('08-21', '08-31', 11, 60),
            ('09-11', '09-20', 10, 60),
        ]
    },
    '林地': {
        'ratio': 12,
        'irrigations': [
            ('05-11', '05-20', 10, 60),
            ('06-01', '06-10', 10, 60),
            ('07-11', '07-20', 10, 60),
            ('08-01', '08-10', 10, 60),
            ('08-21', '08-31', 11, 60),
            ('09-11', '09-20', 10, 60),
        ]
    },
    '葡萄': {
        'ratio': 11,
        'irrigations': [
            ('04-16', '04-25', 10, 70),
            ('05-05', '05-15', 11, 50),
            ('06-15', '06-25', 11, 50),
            ('07-08', '07-19', 12, 60),
            ('07-26', '08-05', 11, 50),
            ('08-15', '08-25', 11, 50),
            ('10-18', '10-29', 12, 60),
        ]
    },
}

year = 2026

def parse_date(s):
    m, d = s.split('-')
    return datetime(year, int(m), int(d))

# ========== 计算灌水率 ==========
# 灌水率 q = alpha * m / (T * 86400) * 10000 / 10000
# alpha = 种植比例(小数), m = 灌水定额(m3/亩), T = 灌水天数
# q 的单位: m3/(s·万亩)
# 公式: q = alpha * m / (T * 86400)  [m3/(s·亩)] * 10000 [亩/万亩]
# 简化: q = alpha * m * 10000 / (T * 86400) = alpha * m / (T * 8.64)

# 按天计算每天的灌水率
start_date = datetime(year, 4, 1)
end_date = datetime(year, 11, 15)
num_days = (end_date - start_date).days + 1

# 每天每种作物的灌水率
daily_q = {crop: np.zeros(num_days) for crop in crops}
daily_q_total = np.zeros(num_days)
dates = [start_date + timedelta(days=i) for i in range(num_days)]

for crop_name, crop_data in crops.items():
    alpha = crop_data['ratio'] / 100.0
    for (start_s, end_s, T, m) in crop_data['irrigations']:
        d_start = parse_date(start_s)
        d_end = parse_date(end_s)
        q = alpha * m / (T * 8.64)  # m3/(s·万亩)
        for d in range(num_days):
            if d_start <= dates[d] <= d_end:
                daily_q[crop_name][d] += q

for i in range(num_days):
    daily_q_total[i] = sum(daily_q[c][i] for c in crops)

# ========== 绘制灌水率图 ==========
fig, ax = plt.subplots(figsize=(18, 8))

colors = {'棉花': '#E74C3C', '苜蓿': '#27AE60', '林地': '#2980B9', '葡萄': '#F39C12'}
bottom = np.zeros(num_days)

for crop_name in ['棉花', '苜蓿', '林地', '葡萄']:
    q_vals = daily_q[crop_name]
    # 绘制堆叠面积图
    ax.fill_between(dates, bottom, bottom + q_vals, alpha=0.7, label=crop_name, color=colors[crop_name], step='mid')
    bottom += q_vals

# 绘制总灌水率线
ax.plot(dates, daily_q_total, 'k-', linewidth=1.5, label='总灌水率', drawstyle='steps-mid')

ax.set_xlabel('日期', fontsize=14)
ax.set_ylabel('灌水率 q [m3/(s*万亩)]', fontsize=14)
ax.set_title('灌水率图（修正前）', fontsize=16)
ax.legend(fontsize=12, loc='upper left')
ax.xaxis.set_major_formatter(DateFormatter('%m-%d'))
ax.xaxis.set_major_locator(DayLocator(interval=5))
plt.xticks(rotation=45)
ax.grid(True, alpha=0.3)
ax.set_xlim(datetime(year, 4, 1), datetime(year, 11, 15))

plt.tight_layout()
plt.savefig(r'd:\灌排第四次\灌水率图_修正前.png', dpi=150)
plt.close()
print("修正前灌水率图已保存")

# ========== 灌水率修正 ==========
# 修正原则：
# 1. 灌水率图中短暂的高峰可适当削减，移至附近低谷处
# 2. 修正后灌水率应连续、平稳
# 3. 修正前后总水量不变（面积相等）

# 先打印每天的灌水率，找出峰值
print("\n===== 每日总灌水率 =====")
for i in range(num_days):
    if daily_q_total[i] > 0:
        print(f"{dates[i].strftime('%m-%d')}: {daily_q_total[i]:.4f}")

# 找最大值
max_q = max(daily_q_total)
max_date = dates[np.argmax(daily_q_total)]
print(f"\n最大灌水率: {max_q:.4f} m3/(s·万亩), 日期: {max_date.strftime('%m-%d')}")

# 计算修正后的设计灌水率
# 通常取灌水率图中持续时间较长且较大的值作为设计灌水率
# 观察灌水率分布，取修正后的设计灌水率

# 统计各月平均灌水率（非零日）
from collections import defaultdict
monthly_q = defaultdict(list)
for i in range(num_days):
    if daily_q_total[i] > 0:
        month = dates[i].month
        monthly_q[month].append(daily_q_total[i])

print("\n===== 各月灌水率统计 =====")
for month in sorted(monthly_q.keys()):
    vals = monthly_q[month]
    print(f"{month}月: 平均={np.mean(vals):.4f}, 最大={max(vals):.4f}, 最小={min(vals):.4f}")

# 修正：将短时间的高峰削减，补到低谷
# 采用平滑修正方法
q_corrected = daily_q_total.copy()

# 修正步骤：
# 1. 找出大于设计灌水率的短暂高峰
# 2. 将超出部分移至附近低谷

# 先确定一个初步的设计灌水率候选值
# 取非零灌水率的中位数作为参考
nonzero_q = daily_q_total[daily_q_total > 0]
q_median = np.median(nonzero_q)
q_mean = np.mean(nonzero_q)
print(f"\n非零灌水率统计: 均值={q_mean:.4f}, 中位数={q_median:.4f}, 最大={max(nonzero_q):.4f}")

# 设计灌水率通常取灌水率图中较大且持续时间较长的值
# 这里我们进行修正
# 修正方法：对灌水率进行平滑处理，将高峰削减补到低谷

# 手动修正：观察数据后确定修正方案
# 4月有棉花和葡萄同时灌水，可能产生高峰
# 需要将一些灌水时间调整

# 打印各作物每次灌水的灌水率
print("\n===== 各作物各次灌水的灌水率 =====")
for crop_name, crop_data in crops.items():
    alpha = crop_data['ratio'] / 100.0
    for idx, (start_s, end_s, T, m) in enumerate(crop_data['irrigations']):
        q = alpha * m / (T * 8.64)
        print(f"{crop_name} 第{idx+1}次: {start_s}~{end_s}, T={T}天, m={m}m3/亩, q={q:.4f} m3/(s·万亩)")