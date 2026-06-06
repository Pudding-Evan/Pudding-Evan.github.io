# Elysium 美术风格指南

本文件作为后续所有站点美术素材的统一标准。旧的羊皮纸/道具规则不再作为主方向；从现在开始，以“像素 / 童话 / 风格化 / RPG 冒险游戏风格，有明显手绘气息”为准。

## 核心风格

- 类型：个人网站的童话 RPG 冒险游戏界面素材。
- 气质：温暖、奇幻、探索感，像一个可进入的小世界。
- 画法：像素感与手绘感结合，不是纯扁平图标，也不是写实插画。
- 质感：边缘有手绘描线，材质有颗粒、旧纸、木头、石头、苔藓、藤蔓、布料等细节。
- 视觉密度：装饰丰富但不杂乱，中心内容区域要能承载文字和交互。

## 关键词

生成素材时优先使用这些描述：

```text
pixel art, fairy-tale, stylized, cozy RPG adventure game, hand-painted feeling,
storybook fantasy, warm parchment, carved wood, soft painterly pixels,
whimsical game UI, handcrafted texture, charming adventure world
```

中文描述可写为：

```text
像素风、童话感、风格化、RPG 冒险游戏界面、明显手绘气息、温暖奇幻、探索感、旧纸、木牌、藤蔓、游戏 UI 质感
```

## 颜色方向

- 外层背景：深海军蓝、夜空蓝、蓝黑色，适合承托星光和羊皮纸。
- 主体面板：暖羊皮纸色、旧纸米黄、浅棕阴影。
- 木质结构：深棕、红棕、焦糖棕，带手绘高光。
- 当前选中态：苔藓绿、橄榄绿，配浅金文字或暖白文字。
- 点缀色：星光金、篝火橙、魔法蓝、藤蔓绿。
- 避免：现代霓虹、玻璃拟态、纯扁平大色块、过度赛博、写实金属。

## 材质与线条

- 线条应有手绘抖动和深色描边，不要过于几何干净。
- 木牌需要木纹、裂痕、边缘磨损、钉子或绳索细节。
- 羊皮纸需要旧纸斑点、压痕、磨边、轻微卷曲和不规则边缘。
- 徽章可以使用盾牌、木牌、宝石、树叶、金属小包边，但整体仍应温暖可爱。
- 像素感应体现在边缘、块面和细节颗粒上，不要变成低清晰度模糊图。

## 导航栏素材规范

导航栏优先使用图片素材实现主要质感，CSS 只负责摆放、缩放、响应式裁切和状态切换。

建议拆成以下素材：

- `nav/parchment-bar.png`：横向羊皮纸导航条，透明背景，中心区域干净，边缘有手绘旧纸和轻微木质压边。
- `nav/brand-crest.png`：左侧品牌徽章，风格接近参考图的盾牌/木牌组合，可承载 `ELYSIUM`。
- `nav/tab-normal.png`：普通导航按钮底图，木牌或浅羊皮纸质感。
- `nav/tab-active.png`：当前导航按钮底图，苔藓绿色或绿色木牌质感。
- `nav/avatar-token.png`：可选右侧小头像圆章，后续如果需要再接入。

导航文字保持简单：

```text
ELYSIUM / NOTE / VIDEO / GITHUB
```

文字可以由网页叠加，不要求生成进图片里；如果必须生成文字，需保证拼写清晰，不要出现乱码或伪文字。

## 页面场景素材规范

后续页面主视觉建议分为：

- 主页：白天山谷、远处城镇、云、河流、小冒险者背影。
- 文章页：森林遗迹、溪流、石阶、萤火、安静探索感。
- 视频页：夜晚营地、帐篷、篝火、树影、小冒险者。
- 页脚：横向地面条、草、石头、花、火堆、小角色，用作页面收口。

场景图需要是清晰的横向插画，适合放入羊皮纸页面框架中，不要生成现代网页 mockup。

## 反向约束

避免以下结果：

- 现代 SaaS 卡片、玻璃拟态、极简扁平 UI。
- 写实照片、3D 渲染、厚重油画、暗黑恐怖风。
- 纯矢量图标、没有纹理的大色块。
- 过多文字、乱码文字、伪英文、复杂魔法阵占据中心。
- 过强投影、发光过曝、无法融入网页的孤立背景。

## 通用生成提示词模板

```text
Create a transparent-background website UI asset in a pixel-art, fairy-tale, stylized RPG adventure game style with a clear hand-painted feeling.
The asset should feel handcrafted, warm, whimsical, and suitable for a personal website called Elysium.
Use warm parchment, carved wood, moss green, soft golden highlights, dark brown hand-drawn outlines, painterly pixel clusters, tiny scratches, old-paper speckles, and subtle adventure-game details.
Keep the center readable and usable for web text or interaction when applicable.
No photorealism, no 3D render, no modern glassmorphism, no flat vector style, no watermark, no random readable text, no pseudo letters.
```
