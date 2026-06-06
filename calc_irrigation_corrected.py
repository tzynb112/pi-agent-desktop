import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.dates import DateFormatter, DayLocator
from datetime import datetime, timedelta
import numpy as np

plt.rcParams['font.sans-serif'] = ['Microsoft YaHei', 'SimHei']
plt.rcParams['axes.unicode_minus'] = False
plt.rcParams['font.family'] = 'sans-serif'

year = 2026

# ========== 修正后的灌水数据 ==========
# 修正原则：
# 1. 短暂高峰适当削减，移至附近低谷
# 2. 修正后灌水率连续平稳
# 3. 修正前后总水量不变
# 
# 分析修正前灌水率图：
# - 08-01~08-05 出现最大峰值 0.2454（棉花+林地+苜蓿+葡萄重叠）
# - 05-11~05-15 峰值 0.1759（苜蓿+林地+葡萄重叠）
# - 06-10 峰值 0.1812（棉花+林地+苜蓿重叠）
# - 07-11~07-19 峰值 0.1817（苜蓿+林地+葡萄重叠）
# - 09-11~09-20 峰值 0.1875（棉花+苜蓿+林地重叠）
#
# 修正方案：
# 1. 8月1-5日高峰(0.2454)：将葡萄第5次灌水(07-26~08-05)提前到07-21~07-25
#    这样8月1-5日只有棉花+林地+苜蓿 = 0.1875
# 2. 5月11-15日高峰(0.1759)：将葡萄第2次灌水(05-05~05-15)延后到05-16~05-20
#    但05-16~05-20已有苜蓿+林地=0.1181，加上葡萄=0.1760，反而更高
#    改为：将葡萄第2次提前到05-01~05-04（4天不够，需11天）
#    改为：将葡萄第2次延后到05-21~05-31
#    这样05-11~05-15只有苜蓿+林地=0.1181
#    05-21~05-31有苜蓿+林地+葡萄=0.1181+0.0579=0.1760...还是高
#    改为：将葡萄第2次(05-05~05-15)不动，将苜蓿第1次(05-11~05-20)延后到05-21~05-30
#    这样05-11~05-15只有林地+葡萄=0.0833+0.0579=0.1412
#    05-05~05-10只有葡萄=0.0579
#    05-21~05-30有林地+苜蓿=0.0833+0.0347=0.1181
# 3. 6月10日高峰(0.1812)：将棉花第2次(06-10~06-20)延后到06-11~06-21
#    这样06-10只有林地+苜蓿=0.1181，06-11~06-20有棉花+林地+苜蓿=0.0631+0.0833+0.0347=0.1811
#    效果不大。改为将棉花第2次提前到06-01~06-09（9天不够需11天）
#    改为将棉花第2次延后到06-21~07-01
#    这样06-10只有林地+苜蓿=0.1181
#    06-21~07-01有棉花+葡萄(06-15~06-25)=0.0631+0.0579=0.1210
#    但06-21~06-25还有葡萄=0.0579，总=0.1210
#    07-01有棉花=0.0631，07-01~07-10还有棉花第3次=0.0694，冲突了
#    改为将棉花第2次延后到06-21~07-01(11天)
#    06-10~06-20只有林地+苜蓿=0.1181（06-10）和苜蓿(06-11~06-10)=0.0347
#    不对，06-01~06-10有林地+苜蓿=0.1181，06-10这天棉花也灌
#    实际上06-10高峰是因为棉花第2次开始日06-10与林地+苜蓿(06-01~06-10)重叠
#    将棉花第2次延后1天到06-11~06-21即可
#    06-10: 林地+苜蓿=0.1181
#    06-11~06-20: 棉花+林地+苜蓿=0.1811（几乎不变）
#    这个修正意义不大
#
# 重新考虑修正方案，更系统地处理：
# 主要高峰：8月1-5日(0.2454)需要修正
# 
# 修正方案（调整灌水时间）：
# 1. 将葡萄第5次灌水(07-26~08-05, 11天)调整为07-21~07-31
#    修正后：07-21~07-25有苜蓿+林地+葡萄=0.0347+0.0833+0.0579=0.1759
#    07-26~07-31有葡萄=0.0579（苜蓿林地7月11-20已结束）
#    08-01~08-05有棉花+林地+苜蓿=0.0694+0.0833+0.0347=0.1875
#    还是高，但比0.2454低
#
# 2. 将苜蓿第4次(08-01~08-10)延后到08-11~08-20
#    修正后：08-01~08-05有棉花+林地+葡萄(07-26~08-05)=0.0694+0.0833+0.0579=0.2106
#    08-06~08-10有棉花+林地=0.0694+0.0833=0.1527
#    08-11~08-20有苜蓿+葡萄(08-15~08-25)=0.0347+0.0579=0.0926(08-11~08-14)
#    08-15~08-20有苜蓿+葡萄=0.0926
#    08-21~08-25有林地+葡萄=0.0758+0.0579=0.1337
#    08-26~08-31有林地=0.0758
#    峰值从0.2454降到0.2106
#
# 综合修正方案：
# - 将苜蓿第1次(05-11~05-20)延后到05-21~05-30
# - 将葡萄第5次(07-26~08-05)提前到07-21~07-31
# - 将苜蓿第4次(08-01~08-10)延后到08-11~08-20

# 定义修正后的作物灌水数据
crops_corrected = {
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
            ('05-21', '05-30', 10, 60),  # 修正：05-11~05-20 → 05-21~05-30
            ('06-01', '06-10', 10, 60),
            ('07-11', '07-20', 10, 60),
            ('08-11', '08-20', 10, 60),  # 修正：08-01~08-10 → 08-11~08-20
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
            ('07-21', '07-31', 11, 50),  # 修正：07-26~08-05 → 07-21~07-31
            ('08-15', '08-25', 11, 50),
            ('10-18', '10-29', 12, 60),
        ]
    },
}

def parse_date(s):
    m, d = s.split('-')
    return datetime(year, int(m), int(d))

start_date = datetime(year, 4, 1)
end_date = datetime(year, 11, 15)
num_days = (end_date - start_date).days + 1
dates = [start_date + timedelta(days=i) for i in range(num_days)]

# 计算修正后每天灌水率
daily_q_corrected = {crop: np.zeros(num_days) for crop in crops_corrected}
daily_q_total_corrected = np.zeros(num_days)

for crop_name, crop_data in crops_corrected.items():
    alpha = crop_data['ratio'] / 100.0
    for (start_s, end_s, T, m) in crop_data['irrigations']:
        q = alpha * m / (T * 8.64)
        d_start = parse_date(start_s)
        d_end = parse_date(end_s)
        for d in range(num_days):
            if d_start <= dates[d] <= d_end:
                daily_q_corrected[crop_name][d] += q

for i in range(num_days):
    daily_q_total_corrected[i] = sum(daily_q_corrected[c][i] for c in crops_corrected)

# 打印修正后灌水率
print("===== 修正后每日总灌水率 =====")
for i in range(num_days):
    if daily_q_total_corrected[i] > 0:
        print(f"{dates[i].strftime('%m-%d')}: {daily_q_total_corrected[i]:.4f}")

max_q_corrected = max(daily_q_total_corrected)
max_date_corrected = dates[np.argmax(daily_q_total_corrected)]
print(f"\n修正后最大灌水率: {max_q_corrected:.4f} m3/(s·万亩), 日期: {max_date_corrected.strftime('%m-%d')}")

# ========== 绘制修正后灌水率图 ==========
fig, ax = plt.subplots(figsize=(18, 8))

colors = {'棉花': '#E74C3C', '苜蓿': '#27AE60', '林地': '#2980B9', '葡萄': '#F39C12'}
bottom = np.zeros(num_days)

for crop_name in ['棉花', '苜蓿', '林地', '葡萄']:
    q_vals = daily_q_corrected[crop_name]
    ax.fill_between(dates, bottom, bottom + q_vals, alpha=0.7, label=crop_name, color=colors[crop_name], step='mid')
    bottom += q_vals

ax.plot(dates, daily_q_total_corrected, 'k-', linewidth=1.5, label='总灌水率', drawstyle='steps-mid')

# 绘制设计灌水率线
q_design = max_q_corrected
ax.axhline(y=q_design, color='red', linestyle='--', linewidth=2, label=f'设计灌水率 q={q_design:.4f}')

ax.set_xlabel('日期', fontsize=14)
ax.set_ylabel('灌水率 q [m3/(s*万亩)]', fontsize=14)
ax.set_title('灌水率图（修正后）', fontsize=16)
ax.legend(fontsize=12, loc='upper left')
ax.xaxis.set_major_formatter(DateFormatter('%m-%d'))
ax.xaxis.set_major_locator(DayLocator(interval=5))
plt.xticks(rotation=45)
ax.grid(True, alpha=0.3)
ax.set_xlim(datetime(year, 4, 1), datetime(year, 11, 15))

plt.tight_layout()
plt.savefig(r'd:\灌排第四次\灌水率图_修正后.png', dpi=150)
plt.close()
print("\n修正后灌水率图已保存")

# ========== 任务2：计算干渠渠首引水流量 ==========
print("\n" + "="*60)
print("任务2：干渠渠首引水流量计算")
print("="*60)

A_total = 7.79  # 万亩
eta_f = 0.90    # 田间水利用系数

# Q = q_design * A / eta_f
Q_channel = q_design * A_total / eta_f
print(f"\n设计灌水率 q = {q_design:.4f} m3/(s·万亩)")
print(f"总灌溉面积 A = {A_total} 万亩")
print(f"田间水利用系数 eta_f = {eta_f}")
print(f"\n干渠渠首引水流量:")
print(f"Q = q × A / eta_f")
print(f"Q = {q_design:.4f} × {A_total} / {eta_f}")
print(f"Q = {Q_channel:.4f} m3/s")
print(f"Q ≈ {Q_channel:.2f} m3/s")

# ========== 汇总 ==========
print("\n" + "="*60)
print("计算结果汇总")
print("="*60)
print(f"\n1. 设计灌水率（修正后）: q = {q_design:.4f} m3/(s·万亩)")
print(f"2. 干渠渠首引水流量: Q = {Q_channel:.4f} m3/s ≈ {Q_channel:.2f} m3/s")