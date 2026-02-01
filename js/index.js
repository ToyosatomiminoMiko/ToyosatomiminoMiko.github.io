// 2025.12.17:06:24:00
const { createApp, ref, onMounted, onUnmounted } = Vue;

window.onload = function () { // 在网页加载完毕后立刻执行操作
    var imgs = document.getElementsByClassName("bgimg");
    for (var i = 0; i < imgs.length; i++) {
        imgs[i].onclick = function () { // onclick事件会在元素被点击时发生
            //document.body.style.setProperty("backgroundImage", "url('" + this.src + "')", "important");
            document.body.style.cssText = 'background-image: url("' + this.src + '") !important;';
            //console.log('background changed:' + this.src);
        }
    }
}
