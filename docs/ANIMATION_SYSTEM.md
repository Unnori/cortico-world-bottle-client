# 🎬 漂流瓶 WebUI 动画系统说明

## 概览

重构后的 WebUI 采用了分层、渐进的动画系统，确保在提升用户体验的同时保持性能和可访问性。

---

## 🌟 核心动画原则

### 1. 缓动函数一致性
```css
--bottle-ease-out: cubic-bezier(0.2, 0.7, 0.2, 1);
--bottle-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
```

- **ease-out**: 用于大多数动画，自然的减速感
- **spring**: 用于弹性效果，如按钮按下/释放

### 2. 时长层级
```css
--bottle-fast: 150ms;
--bottle-base: 280ms;
--bottle-slow: 420ms;
```

- **fast**: 微交互 (悬停、焦点)
- **base**: 标准过渡 (选项卡切换、卡片展开)
- **slow**: 页面级动画 (加载、模态框)

---

## 📦 页面级动画

### 初始加载动画
**触发时机**: 页面首次渲染
**效果组合**: 淡入 + 上滑 + 模糊消散

```css
@keyframes bottle-mount {
  from {
    opacity: 0;
    transform: translateY(16px);
    filter: blur(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
    filter: blur(0);
  }
}

#root {
  animation: bottle-mount var(--bottle-slow) var(--bottle-ease-out);
}
```

**视觉效果**:
```
0ms     ──► 420ms
━━━━━━━━━━━━━━━━━━━━►
模糊 8px → 清晰
透明 0% → 显示 100%
下移 16px → 归位 0px
```

---

## 🗂️ 选项卡动画

### 面板切换
**触发时机**: 点击不同的选项卡
**效果**: 淡出旧面板 → 淡入新面板 + 轻微模糊

```css
.bottle-pane {
  opacity: 0;
  transform: translateY(8px);
  filter: blur(4px);
  transition:
    opacity var(--bottle-base) var(--bottle-ease-out),
    transform var(--bottle-base) var(--bottle-ease-out),
    filter var(--bottle-base) var(--bottle-ease-out);
}

.bottle-pane.is-active {
  opacity: 1;
  transform: translateY(0);
  filter: blur(0);
}
```

### 活动指示器滑动
**视觉效果**: 跟随鼠标点击滑动到新位置

```css
.bottle-tabs::after {
  /* 底部滑动条 */
  transition:
    left var(--bottle-base) var(--bottle-ease-out),
    width var(--bottle-base) var(--bottle-ease-out);
}
```

---

## 🎴 卡片动画

### 卡片入场
**触发时机**: 卡片首次出现或列表项加载
**效果组合**: 缩放 + 位移 + 淡入

```css
@keyframes bottle-card-in {
  from {
    opacity: 0;
    transform: scale(0.92) translateY(12px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.bottle-card {
  animation: bottle-card-in var(--bottle-base) var(--bottle-ease-out);
}
```

**时间轴**:
```
0ms          280ms
┌────────────────┐
│ Scale: 0.92→1  │
│ Y: 12px→0      │
│ Opacity: 0→1   │
└────────────────┘
```

### 卡片悬停
**触发时机**: 鼠标悬停在可交互卡片上
**效果**: 轻微上浮 + 阴影增强

```css
.bottle-card {
  transition:
    transform var(--bottle-fast) var(--bottle-ease-out),
    box-shadow var(--bottle-fast) var(--bottle-ease-out);
}

.bottle-card:hover {
  transform: translateY(-2px);
  box-shadow:
    0 8px 24px var(--bottle-shadow),
    0 0 0 1px var(--bottle-line),
    inset 0 -1px 0 var(--bottle-accent-dim);
}
```

---

## 🔘 按钮动画

### 主要按钮 (Primary)
**悬停效果**: 缩放 + 背景色变化 + 阴影增强

```css
.bottle-pill {
  transition:
    transform var(--bottle-fast) var(--bottle-ease-out),
    background var(--bottle-fast) var(--bottle-ease-out),
    box-shadow var(--bottle-fast) var(--bottle-ease-out);
}

.bottle-pill:hover {
  transform: scale(1.05);
  background: var(--bottle-accent-bright);
  box-shadow: 0 4px 16px rgba(56, 189, 248, 0.3);
}
```

### 按钮点击反馈
**激活效果**: 轻微缩小 (弹性感)

```css
.bottle-pill:active {
  transform: scale(0.98);
  transition-duration: 80ms; /* 更快的响应 */
}
```

**交互时间线**:
```
Rest     Hover      Click      Release
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━►
Scale: 1.0 → 1.05 → 0.98 → 1.05 → 1.0
```

---

## 💡 状态指示器

### 徽章发光
**效果**: 脉冲式发光吸引注意

```css
@keyframes bottle-badge-pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 var(--bottle-accent);
  }
  50% {
    box-shadow: 0 0 16px 4px var(--bottle-accent);
  }
}

.bottle-badge {
  animation: bottle-badge-pulse 2s var(--bottle-ease-out) infinite;
}
```

### 进度条填充
**效果**: 渐变色滑动 + 闪光效果

```css
@keyframes bottle-progress-shine {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.bottle-progress-fill {
  background: linear-gradient(
    90deg,
    var(--bottle-accent-dim),
    var(--bottle-accent),
    var(--bottle-accent-bright),
    var(--bottle-accent)
  );
  background-size: 200% 100%;
  animation: bottle-progress-shine 1.5s ease-in-out infinite;
}
```

---

## 🪟 Windows 桌面卡片动画

### 卡片入场 (PowerShell WPF)
**效果组合**: 淡入 + 上滑 + 缩放

```powershell
# 不透明度动画
$fade = [DoubleAnimation]::new(0, 1, 300ms)
$fade.EasingFunction = CubicEase(EaseOut)

# Y轴位移动画
$rise = [DoubleAnimation]::new(12, 0, 400ms)
$rise.EasingFunction = CubicEase(EaseOut)

# 缩放动画
$scaleIn = [DoubleAnimation]::new(0.96, 1.0, 400ms)
$scaleIn.EasingFunction = CubicEase(EaseOut)
```

**时间轴**:
```
0ms               300ms           400ms
├─────────────────┬───────────────┤
│   淡入 0→1      │               │
├─────────────────┴───────────────┤
│   上滑 12px→0 + 缩放 0.96→1.0   │
└─────────────────────────────────┘
```

### 按钮悬停 (桌面卡片)
**效果**: 缩放 1.0 → 1.05

```powershell
$hoverScale = [DoubleAnimation]::new(1.0, 1.05, 150ms)
$pill.RenderTransform.BeginAnimation(ScaleXProperty, $hoverScale)
$pill.RenderTransform.BeginAnimation(ScaleYProperty, $hoverScale)
```

---

## ♿ 可访问性支持

### 尊重用户偏好

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

**效果**: 当用户启用"减少动态效果"时，所有动画几乎立即完成，避免引起不适。

### 焦点可见性增强

```css
.bottle-pill:focus-visible {
  outline: 2px solid var(--bottle-accent);
  outline-offset: 3px;
  animation: bottle-focus-ring 0.3s ease-out;
}

@keyframes bottle-focus-ring {
  from {
    outline-color: transparent;
    outline-offset: 0;
  }
}
```

---

## 🎯 性能优化

### 使用 GPU 加速属性
优先使用以下可以触发 GPU 加速的属性：
- ✅ `transform` (translate, scale, rotate)
- ✅ `opacity`
- ✅ `filter` (blur, brightness)

避免动画会触发重排 (reflow) 的属性：
- ❌ `width`, `height`
- ❌ `margin`, `padding`
- ❌ `top`, `left` (改用 `transform`)

### 动画层提升
```css
.bottle-card {
  will-change: transform, opacity;
}

.bottle-card:hover,
.bottle-card:focus-within {
  will-change: auto; /* 动画结束后释放 */
}
```

---

## 📊 动画清单

| 元素 | 触发 | 效果 | 时长 | 缓动 |
|------|------|------|------|------|
| 页面根 | 加载 | 淡入+上滑+模糊 | 420ms | ease-out |
| 选项卡面板 | 切换 | 淡入+位移 | 280ms | ease-out |
| 卡片 | 入场 | 缩放+位移+淡入 | 280ms | ease-out |
| 卡片 | 悬停 | 上浮+阴影 | 150ms | ease-out |
| 按钮 | 悬停 | 缩放 1.05x | 150ms | ease-out |
| 按钮 | 点击 | 缩放 0.98x | 80ms | ease-out |
| 徽章 | 常驻 | 发光脉冲 | 2s | infinite |
| 进度条 | 填充 | 渐变滑动 | 1.5s | infinite |
| 关闭按钮 | 悬停 | 背景+颜色 | 150ms | ease-out |
| 桌面卡片 | 入场 | 淡入+上滑+缩放 | 400ms | ease-out |

---

## 🎨 动画设计哲学

1. **意图导向**: 每个动画都传达明确的含义
   - 淡入 = 出现
   - 上滑 = 从下方进入
   - 缩放 = 强调/响应

2. **分层过渡**: 复杂动画拆解为多个简单动画的组合
   - 单独控制 opacity, transform, filter
   - 错开时长创造视觉深度

3. **性能第一**: 优先使用 GPU 加速属性
   - transform > position
   - opacity > visibility
   - 合理使用 will-change

4. **可访问优先**: 尊重用户的系统设置
   - prefers-reduced-motion
   - 焦点指示器永不隐藏
   - 足够的对比度

---

**文档版本**: 1.0.0
**最后更新**: 2026-11-06
**维护者**: Claude Opus 5.5
