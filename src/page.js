import { createApp } from 'vue';
import { fmt_time } from './utils';

const API_BASE = import.meta.env.PROD
    ? '/api'       // 生产环境走同源 API
    : 'http://127.0.0.1/api';

export function mountPages() {
    fetch(`${API_BASE}/pages`)
        .then(response => response.json())
        .then((pages) => {
            const app = createApp({
                data() { return { pages }; },
                methods: {
                    formatTime(timeString) {
                        const date = new Date(timeString);
                        return fmt_time(date);
                    }
                }
            });
            app.mount('#page_list');
        })
        .catch((error) => console.error("server connection failed:", error));
}