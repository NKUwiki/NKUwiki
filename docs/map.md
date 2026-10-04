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
---

<script setup>
import MapView from '@nkuwiki/theme/theme/components/MapView.vue'
</script>

<MapView />

<style>
/* 地图页全屏：VitePress 空页布局（layout: page）下铺满视口（参考 QUT-WiKi 地图页做法）。
   注意 padding-top 不能清：桌面端 VPNav 是 fixed，内容靠 VPContent 的
   padding-top: var(--vp-nav-height) 让出导航栏；清掉后地图会顶到视口最上面，
   顶部工具条（校区切换/显示定位）被导航盖住，底部还会露出 64px 的 body 白底。 */
.map-page .VPPage {
  max-width: none;
  margin: 0;
  padding: 0;
}

.map-page .VPContent {
  padding: var(--vp-nav-height, 64px) 0 0 !important;
}
</style>
