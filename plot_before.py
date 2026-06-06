import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties
from datetime import datetime, timedelta
import numpy as np
import os

# 直接指定字体文件路径
font_path = r'C:\Windows\Fonts\msyh.ttc'
fp = FontProperties(fname=font_path, size=14)
fp_title = FontProperties(fname=font_path, size=16)
fp_legend = FontProperties(fname=font_path, size=12)
fp_tick = FontProperties(fname=font_path, size=10)

plt.rcParams['axes.unicode_minus'] = False

# ========== 数据定义 ==========
crops = {
    '棉花': {
        'ratio': 10,
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

start_date = datetime(year, 4, 1)
end_date = datetime(year, 11, 15)
num_days = (end_date - start_date).days + 1
dates = [start_date + timedelta(days=i) for i in range(num_days)]

daily_q = {crop: np.zeros(num_days) for crop in crops}
daily_q_total = np.zeros(num_days)

for crop_name, crop_data in crops.items():
    alpha = crop_data['ratio'] / 100.0
    for (start_s, end_s, T, m) in crop_data['irrigations']:
        d_start = parse_date(start_s)
        d_end = parse_date(end_s)
        q = alpha * m / (T * 8.64)
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
    ax.fill_between(dates, bottom, bottom + q_vals, alpha=0.7, label=crop_name, color=colors[crop_name], step='mid')
    bottom += q_vals

ax.plot(dates, daily_q_total, 'k-', linewidth=1.5, label='总灌水率', drawstyle='steps-mid')

ax.set_xlabel('日期', fontproperties=fp)
ax.set_ylabel('灌水率 q [m3/(s*万亩)]', fontproperties=fp)
ax.set_title('灌水率图(修正前)', fontproperties=fp_title)

leg = ax.legend(prop=fp_legend, loc='upper left')

from matplotlib.dates import DateFormatter, DayLocator
ax.xaxis.set_major_formatter(DateFormatter('%m-%d'))
ax.xaxis.set_major_locator(DayLocator(interval=5))
for label in ax.get_xticklabels():
    label.set_fontproperties(fp_tick)
for label in ax.get_yticklabels():
    label.set_fontproperties(fp_tick)

plt.xticks(rotation=45)
ax.grid(True, alpha=0.3)
ax.set_xlim(datetime(year, 4, 1), datetime(year, 11, 15))

plt.tight_layout()
plt.savefig(r'd:\灌排第四次\灌水率图_修正前.png', dpi=150)
plt.close()
print("修正前灌水率图已保存")