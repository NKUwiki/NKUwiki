---
layout: page
sidebar: false
aside: false
footer: false
search: false
outline: false
pageClass: map-page
hideChangelog: true
title: 校园地图
description: 南开大学八里台与津南校区校园地图：教学楼、食堂、宿舍、体育场馆等点位导览与照片。
---

<script setup>
import MapView from '@nkuwiki/wiki-map'
// 点位与密钥属于站点数据，不随组件包分发，从本仓库 data/ 注入
import * as mapData from './.vitepress/data/map-data.js'
</script>

<MapView :data="mapData" />

<style>
/* 地图页全屏：VitePress 空页布局（layout: page）下铺满视口（参考 QUT-WiKi 地图页做法）。
   桌面端（≥60rem）VPNav 是 fixed，内容靠 VPContent 的 padding-top 让出导航栏，
   清掉后地图会顶到视口最上面，顶部工具条被导航盖住；移动端 VPNav 本身占文档流，
   VitePress 默认也不再给 VPContent 加 padding-top，这里若保留 64px 会多出一段留白。 */
.map-page .VPPage {
  max-width: none;
  margin: 0;
  padding: 0;
}

.map-page .VPContent {
  padding: 0 !important;
}

@media (min-width: 60rem) {
  .map-page .VPContent {
    padding: var(--vp-nav-height, 64px) 0 0 !important;
  }
}
</style>
