/*
2025.12.17.06:12:00
APP
页面展示
*/
function fmt_time(datetime) {
    /* 转为字符串后用0填充2位 */
    const year = datetime.getFullYear().toString();
    const month = (datetime.getMonth() + 1).toString().padStart(2, '0');
    const day = datetime.getDate().toString().padStart(2, '0');
    const hours = datetime.getHours().toString().padStart(2, '0');
    const minutes = datetime.getMinutes().toString().padStart(2, '0');
    const seconds = datetime.getSeconds().toString().padStart(2, '0');
    return `${year}.${month}.${day}.${hours}:${minutes}:${seconds}`;
}

fetch("http://127.0.0.1/api/pages")
    .then(response => response.json())
    .then((pages) => Vue.createApp({
        data() {
            return {
                pages
            }
        },
        methods: {
            formatTime(timeString) {
                // 将字符串转换为Date对象，然后使用fmt_time格式化
                const date = new Date(timeString);
                return fmt_time(date);
            }
        }
    }).mount('#page_list'))
    .catch((error) => console.error("server connection failed:", error));


