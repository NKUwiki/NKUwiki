# @nkuwiki/wiki-map

校园地图组件（MapView），自 [QUT-WiKi](https://github.com/QUT-Wiki) 的 MapView 整体移植，基于高德 JS API 2.0。

相对上游的适配：

- 导航外链来源参数改为 NKUwiki；
- 定位走浏览器原生 Geolocation，WGS84 → GCJ02 用本地公式转换（不调高德坐标转换接口，不加载未使用的插件）；
- 移除步行路径规划（AMap.Walking）；
- 主题联动：MutationObserver 监听 `html.dark` 切换高德官方夜间样式。

**组件不内置任何站点数据**：点位、分类、校区与高德密钥全部通过 `data` prop 注入，方便其他学校 / 项目复用。

## 使用

```vue
<script setup>
import MapView from '@nkuwiki/wiki-map'
import * as mapData from './.vitepress/data/map-data.js'
</script>

<template>
  <MapView :data="mapData" />
</template>
```

`data` 对象的必备导出与字段注释见 [map-data.example.js](./map-data.example.js)：

- `BUILDINGS`：点位列表
- `CAMPUS_CONFIG` / `CATEGORY_CONFIG` / `CATEGORY_ICON_PATHS` / `FILTER_LIST`：校区与分类配置
- `AMAP_KEY` / `AMAP_SECURITY_JS_CODE`：高德 Web 端 (JS API) 密钥（[lbs.amap.com](https://lbs.amap.com) 控制台申请，需按站点域名做白名单）

站点真实数据不放本包（如 NKUwiki 的在 `docs/.vitepress/data/map-data.js`）。

## 维护约定

- `MapView.vue` 保持上游原样便于同步，不参与 ESLint；
- 坐标统一 GCJ02（高德坐标系）；百度/腾讯/Apple 导航外链由组件内部做坐标转换。
